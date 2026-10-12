import path from "node:path";
import { parseDocument } from "yaml";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  applyAssignments,
  cacheIsCleaned,
  cacheIsMounted,
  shellCommands,
} from "./docker-package-cache-helpers.ts";
import {
  packageCacheCommand,
  commandOption,
  type CacheTool,
  type PackageCacheSettings,
  type PackageCacheState,
} from "./docker-package-cache-paths.ts";

const rules = [
  {
    tool: "bun",
    id: "dockerfile-bun-install-without-cleanup-or-cache-mount",
    action:
      "Mount Bun's effective global download cache, or remove only that cache in the same RUN after a non-symlink install. Bun's --no-cache flag alone does not prove the cache stays out of the layer.",
  },
  {
    tool: "npm",
    id: "dockerfile-npm-install-without-cleanup-or-cache-mount",
    action:
      "Mount npm's effective cache directory, or use npm cache clean --force in the same RUN after installation. Keep installed node_modules intact.",
  },
  {
    tool: "pnpm",
    id: "dockerfile-pnpm-install-without-cleanup-or-cache-mount",
    action:
      "Mount pnpm's effective content-addressable store, or remove only the disposable store in the same RUN. Preserve node_modules/.pnpm and any runtime-linked global virtual store.",
  },
  {
    tool: "uv",
    id: "dockerfile-uv-install-without-no-cache-or-cache-mount",
    action:
      "Use uv --no-cache, or mount the effective uv cache directory with BuildKit type=cache. Use UV_LINK_MODE=copy when mounting across filesystems, and preserve the installed virtual environment.",
  },
  {
    tool: "yarn",
    id: "dockerfile-yarn-install-without-cleanup-or-cache-mount",
    action:
      "For Yarn Classic, mount the explicit cache directory or run yarn cache clean in the same RUN after installation. Preserve installed dependencies; do not remove Yarn PnP or zero-install runtime archives.",
  },
] as const;

async function optionalText(
  context: RepositoryScanContext,
  root: string,
  name: string,
): Promise<string> {
  const file = path.join(root, name);
  return (await context.pathExists(file)) ? ((await context.readTextFileOrWarn(file)) ?? "") : "";
}

function setting(text: string, key: string): string | undefined {
  const value = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "mi").exec(text)?.[1];
  return value?.replace(/^['"]|['"]$/g, "");
}

export async function collectPackageCacheSettings(
  context: RepositoryScanContext,
  contextPath: string,
  instructions: CollectedDockerfileInstruction[],
): Promise<PackageCacheSettings> {
  if (!instructions.some((instruction) => /\b(?:bun|npm|pnpm|yarn)\b/.test(instruction.text))) {
    return {};
  }
  const bunfig = await optionalText(context, contextPath, "bunfig.toml");
  const bunCacheSection = /^\s*\[install\.cache\]\s*\r?\n([^[]*)/m.exec(bunfig)?.[1] ?? "";
  const npmrc = await optionalText(context, contextPath, ".npmrc");
  const yarnrc = await optionalText(context, contextPath, ".yarnrc");
  const pnpmText = await optionalText(context, contextPath, "pnpm-workspace.yaml");
  const pnpmDoc = parseDocument(pnpmText);
  const store = pnpmDoc.get("storeDir");
  const virtualStore = pnpmDoc.get("enableGlobalVirtualStore");
  const packagePath = path.join(contextPath, "package.json");
  const pkg = (await context.pathExists(packagePath))
    ? (await context.loadPackageJson(packagePath)).value
    : undefined;
  const manager = typeof pkg?.packageManager === "string" ? pkg.packageManager : "";
  return {
    bunCache: setting(bunCacheSection, "dir"),
    npmCache: setting(npmrc, "cache"),
    pnpmStore: typeof store === "string" ? store : setting(npmrc, "store-dir"),
    globalVirtualStore:
      virtualStore === true || setting(npmrc, "enable-global-virtual-store") === "true",
    yarnCache:
      /^\s*cache-folder\s+["']?([^"'\r\n]+)["']?\s*$/m.exec(yarnrc)?.[1]?.trim() ??
      setting(npmrc, "cache"),
    modernYarn:
      /^yarn@(?:[2-9]|\d{2,})\./.test(manager) ||
      (await context.pathExists(path.join(contextPath, ".yarnrc.yml"))),
  };
}

function nativeCleanup(
  tool: CacheTool,
  cache: string,
  commands: string[][],
  state: PackageCacheState,
  settings: PackageCacheSettings,
): boolean {
  if (
    commands.some(
      (tokens) =>
        tokens[0] === "export" ||
        tokens[0] === "unset" ||
        (tokens[1] === "config" && tokens[2] === "set"),
    )
  ) {
    return false;
  }
  return commands.some((tokens) => {
    if (tool === "yarn" && tokens[0] === "yarn" && tokens[1] === "cache" && tokens[2] === "clean") {
      for (let index = 3; index < tokens.length; index++) {
        if (tokens[index] === "--cache-folder") {
          if (!/^[^-]/.test(tokens[index + 1] ?? "")) {
            return false;
          }
          index++;
          continue;
        }
        if (!/^--cache-folder=.+$/.test(tokens[index] ?? "")) {
          return false;
        }
      }
      return (
        packageCacheCommand(["yarn", "install", ...tokens.slice(3)], state, settings)?.cache ===
        cache
      );
    }
    if (tool === "uv" && tokens.join(" ") === "uv cache clean") {
      return packageCacheCommand(["uv", "sync"], state, settings)?.cache === cache;
    }
    if (
      tool === "npm" &&
      tokens[0] === "npm" &&
      tokens[1] === "cache" &&
      tokens[2] === "clean" &&
      tokens.includes("--force")
    ) {
      for (let index = 3; index < tokens.length; index += 1) {
        if (tokens[index] === "--cache") {
          index += 1;
          continue;
        }
        if (tokens[index] !== "--force" && !tokens[index]?.startsWith("--cache=")) {
          return false;
        }
      }
      const cleanCache = packageCacheCommand(
        ["npm", "ci", ...tokens.slice(3)],
        state,
        settings,
      )?.cache;
      return cleanCache === cache && commandOption(tokens, "--cache") !== "false";
    }
    return false;
  });
}

export function collectPackageCacheDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
  settings: PackageCacheSettings,
): Diagnostic[] {
  let state: PackageCacheState = {
    environment: new Map(),
    rootUser: true,
    workdir: "/",
    modernYarn: false,
  };
  let alias: string | undefined;
  const stages = new Map<string, PackageCacheState>();
  const lines = new Map<CacheTool, number[]>();
  for (const instruction of instructions) {
    const keyword =
      instruction.keyword?.toUpperCase() ??
      instruction.text.trim().split(/\s+/, 1)[0]?.toUpperCase();
    const content = instruction.argumentsContent ?? instruction.text.replace(/^\s*\S+\s+/, "");
    if (keyword === "FROM") {
      if (alias) {
        stages.set(alias, { ...state, environment: new Map(state.environment) });
      }
      const image = content.split(/\s+/).find((token) => !token.startsWith("--"));
      const inherited = stages.get(image?.toLowerCase() ?? "");
      state = {
        environment: new Map(inherited?.environment),
        rootUser: inherited?.rootUser ?? true,
        workdir: inherited?.workdir ?? "/",
        modernYarn: inherited?.modernYarn ?? false,
        settings: { ...inherited?.settings },
      };
      alias = /\sAS\s+(\S+)$/i.exec(content)?.[1]?.toLowerCase();
    } else if (keyword === "ENV") {
      const tokens = shellCommands(content)[0] ?? [];
      if (tokens[0]?.includes("=")) {
        applyAssignments(tokens, state.environment);
      } else if (tokens[0]) {
        state.environment.set(tokens[0], tokens.slice(1).join(" "));
      }
    } else if (keyword === "USER") {
      state.rootUser = /^(?:root|0)(?::\S+)?$/.test(content.trim());
    } else if (keyword === "WORKDIR") {
      state.workdir = path.posix.resolve(state.workdir, content.trim());
    } else if (keyword === "RUN" && !content.includes("<<")) {
      const commands = instruction.jsonStrings?.length
        ? [instruction.jsonStrings]
        : shellCommands(content.replace(/^(?:\s*--(?:mount|network|security)=\S+\s+)+/, ""));
      for (const [index, tokens] of commands.entries()) {
        if (
          /^(?:npm|pnpm|yarn)$/.test(tokens[0] ?? "") &&
          tokens[1] === "config" &&
          tokens[2] === "set"
        ) {
          const [key, assignedValue] = (tokens[3] ?? "").split("=", 2);
          const value = assignedValue ?? tokens[4];
          const field =
            tokens[0] === "npm" && key === "cache"
              ? "npmCache"
              : tokens[0] === "pnpm" && key === "store-dir"
                ? "pnpmStore"
                : tokens[0] === "yarn" && key === "cache-folder"
                  ? "yarnCache"
                  : undefined;
          if (field && value) {
            state.settings = { ...state.settings, [field]: value };
          }
        }
        if (
          (tokens[0] === "corepack" &&
            tokens[1] === "prepare" &&
            /^yarn@(?:[2-9]|\d{2,})\./.test(tokens[2] ?? "")) ||
          (tokens[0] === "yarn" &&
            tokens[1] === "set" &&
            tokens[2] === "version" &&
            /^(?:berry|stable|(?:[2-9]|\d{2,})\.)/.test(tokens[3] ?? ""))
        ) {
          state.modernYarn = true;
        }
        const command = packageCacheCommand(tokens, state, settings);
        if (!command) {
          continue;
        }
        const remaining = commands.slice(index + 1);
        const cleaned =
          !/\||\b(?:if|then|else|case|for|while|until)\b/.test(content) &&
          (cacheIsCleaned(command.cache, remaining) ||
            nativeCleanup(command.tool, command.cache, remaining, state, settings));
        if (
          cleaned ||
          cacheIsMounted(
            command.cache,
            instruction,
            command.tool === "yarn" ? ["cache", "tmpfs"] : ["cache"],
          )
        ) {
          continue;
        }
        const affected = lines.get(command.tool) ?? [];
        if (!affected.includes(instruction.startLine)) {
          affected.push(instruction.startLine);
        }
        lines.set(command.tool, affected);
      }
    }
  }
  return rules.flatMap((rule) => {
    const affected = lines.get(rule.tool);
    if (!affected?.length) {
      return [];
    }
    const meta = {
      id: rule.id,
      severity: "warning",
      confidence: "medium",
      docsPath: `docs/rules/${rule.id}.md`,
    } satisfies RuleMeta;
    return [
      buildRepositoryDiagnostic(
        { ...repository, primaryWorkflowPath: repository.primaryWorkflowPath ?? workflowPath },
        meta,
        {
          location: { path: dockerfileRelativePath, line: affected[0]!, column: 1 },
          message: `Dockerfile ${dockerfileRelativePath} performs ${rule.tool} dependency installation without externalizing or cleaning its download cache at lines ${affected.join(", ")}.`,
          why: "Dependency download caches can be stored in image layers, increasing build storage and transfer costs. BuildKit cache mounts retain rebuild reuse outside the layer; installed dependencies must remain available at runtime.",
          suggestion: rule.action,
          measurementHint:
            "Compare image layer sizes and cold and warm build times; verify runtime dependency resolution after moving or cleaning only the download cache.",
          aiHandoff: `Review ${rule.tool} installs in ${dockerfileRelativePath}. ${rule.action} Verify tool version, effective cache settings, existing cleanup, and runtime dependency resolution before changing the Dockerfile.`,
          score: 72,
        },
      ),
    ];
  });
}
