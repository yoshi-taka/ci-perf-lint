import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  applyAssignments,
  cacheIsCleaned,
  cacheIsMounted,
  shellCommands,
} from "./docker-package-cache-helpers.ts";

const meta = {
  id: "dockerfile-pip-install-without-no-cache-or-cache-mount",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-pip-install-without-no-cache-or-cache-mount.md",
} satisfies RuleMeta;

const pipPattern = /^(?:\S*\/)?pip(?:3?(?:\.\d+)*)?$/;
const pythonPattern = /^(?:\S*\/)?python(?:3?(?:\.\d+)*)?$/;
// pip's no-cache callback accepts both true and false boolean spellings.
const booleanPattern = /^(?:1|0|true|false|yes|no|on|off|y|n|t|f)$/i;

function pipCachePath(
  tokens: string[],
  stageEnvironment: Map<string, string>,
  rootUser: boolean,
): string | false | undefined {
  const environment = new Map(stageEnvironment);
  let index = tokens[0] === "env" ? 1 : 0;
  index += applyAssignments(tokens.slice(index), environment);
  if (pythonPattern.test(tokens[index] ?? "")) {
    index += 1;
    while (/^-(?:I|u|s|S|E|B)$/.test(tokens[index] ?? "")) {
      index += 1;
    }
    if (tokens[index] !== "-m" || tokens[index + 1] !== "pip") {
      return undefined;
    }
    index += 2;
  } else if (pipPattern.test(tokens[index] ?? "")) {
    index += 1;
  } else {
    return undefined;
  }
  const args = tokens.slice(index);
  const installIndex = args.indexOf("install");
  if (installIndex < 0 || args.includes("--help") || args.includes("--version")) {
    return undefined;
  }
  // Limit global options to visible flags and cache-dir values.
  for (let i = 0; i < installIndex; i += 1) {
    if (args[i] === "--cache-dir") {
      i += 1;
      continue;
    }
    if (
      !/^(?:-[qv]+|--(?:no-cache-dir|isolated|disable-pip-version-check|no-input)|--cache-dir=\S+)$/.test(
        args[i]!,
      )
    ) {
      return undefined;
    }
  }
  const isolated = args.includes("--isolated");
  const home = environment.get("HOME") ?? (rootUser ? "/root" : undefined);
  const cacheHome = environment.get("XDG_CACHE_HOME") ?? (home ? `${home}/.cache` : undefined);
  const configuredCache = isolated ? "" : (environment.get("PIP_CACHE_DIR") ?? "");
  let cache: string | false =
    configuredCache.length > 0 ? configuredCache : cacheHome ? `${cacheHome}/pip` : "";
  if (!isolated && booleanPattern.test(environment.get("PIP_NO_CACHE_DIR") ?? "")) {
    cache = false;
  }
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--no-cache-dir") {
      cache = false;
    } else if (args[i] === "--cache-dir") {
      cache = args[++i] ?? "";
    } else if (args[i]?.startsWith("--cache-dir=")) {
      cache = args[i]!.slice("--cache-dir=".length);
    }
  }
  return cache;
}

export function collectPipCacheDiagnostics(
  repository: RepositorySignals,
  workflowPath: string,
  dockerfileRelativePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  let environment = new Map<string, string>();
  let rootUser = true;
  let alias: string | undefined;
  const stages = new Map<string, { environment: Map<string, string>; rootUser: boolean }>();
  const lines: number[] = [];
  for (const instruction of instructions) {
    const keyword =
      instruction.keyword?.toUpperCase() ??
      instruction.text.trim().split(/\s+/, 1)[0]?.toUpperCase();
    const content = instruction.argumentsContent ?? instruction.text.replace(/^\s*\S+\s+/, "");
    if (keyword === "FROM") {
      if (alias) {
        stages.set(alias, { environment: new Map(environment), rootUser });
      }
      const tokens = content.split(/\s+/).filter((token) => !token.startsWith("--"));
      const inherited = stages.get(tokens[0]?.toLowerCase() ?? "");
      environment = new Map(inherited?.environment);
      rootUser = inherited?.rootUser ?? true;
      alias = /\sAS\s+(\S+)$/i.exec(content)?.[1]?.toLowerCase();
    } else if (keyword === "ENV") {
      const tokens = shellCommands(content)[0] ?? [];
      if (tokens[0]?.includes("=")) {
        applyAssignments(tokens, environment);
      } else if (tokens[0]) {
        environment.set(tokens[0], tokens.slice(1).join(" "));
      }
    } else if (keyword === "USER") {
      rootUser = /^(?:root|0)(?::\S+)?$/.test(content.trim());
    } else if (keyword === "RUN" && !content.includes("<<")) {
      const commands = instruction.jsonStrings?.length
        ? [instruction.jsonStrings]
        : shellCommands(content.replace(/^(?:\s*--(?:mount|network|security)=\S+\s+)+/, ""));
      if (
        commands.some((tokens, index) => {
          const cache = pipCachePath(tokens, environment, rootUser);
          if (cache === undefined || cache === false) {
            return false;
          }
          const cleaned =
            !/\||\b(?:if|then|else|case|for|while|until)\b/.test(content) &&
            cacheIsCleaned(cache, commands.slice(index + 1));
          return !cacheIsMounted(cache, instruction) && !cleaned;
        })
      ) {
        lines.push(instruction.startLine);
      }
    }
  }
  if (!lines.length) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(
      { ...repository, primaryWorkflowPath: repository.primaryWorkflowPath ?? workflowPath },
      meta,
      {
        location: { path: dockerfileRelativePath, line: lines[0]!, column: 1 },
        message: `Dockerfile ${dockerfileRelativePath} installs pip packages without disabling or mounting the pip cache at lines ${lines.join(", ")}.`,
        why: "pip download and wheel caches can remain in Docker image layers, increasing build storage and image transfer costs. A BuildKit cache mount preserves rebuild reuse without baking that cache into the image.",
        suggestion:
          "Use pip install --no-cache-dir for simple installs, or mount the effective pip cache directory with BuildKit type=cache when rebuild reuse matters. Review existing pip configuration and same-layer cleanup before changing the install.",
        measurementHint:
          "Compare image layer size and cold and warm Docker build times after disabling or externally mounting the pip cache.",
        aiHandoff: `Review pip installs in ${dockerfileRelativePath}. Prevent pip caches from being persisted in image layers using --no-cache-dir or a BuildKit cache mount covering the effective cache directory. Preserve dependency versions and install behavior; verify existing configuration and cleanup.`,
        score: 72,
      },
    ),
  ];
}
