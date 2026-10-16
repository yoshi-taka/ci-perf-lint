import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { CollectedDockerfileInstruction } from "./dockerfile-instructions.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { cacheIsMounted } from "./docker-package-cache-helpers.ts";
import { describeLaterCacheCleanup } from "./docker-later-cache-cleanup.ts";
import {
  directCommand,
  dockerRunCommands,
  removesDirectory,
} from "./docker-image-metadata-helpers.ts";

const meta = {
  id: "dockerfile-rpm-install-without-cleanup-or-cache-mount",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-rpm-install-without-cleanup-or-cache-mount.md",
} satisfies RuleMeta;
const defaultPaths: Record<string, string[]> = {
  yum: ["/var/cache/yum"],
  // The dnf executable can select DNF4 or DNF5. Without version evidence,
  // require coverage of both locations rather than guessing the implementation.
  dnf: ["/var/cache/dnf", "/var/cache/libdnf5"],
  microdnf: ["/var/cache/yum"],
  zypper: ["/var/cache/zypp"],
};
const valueOptions = new Set([
  "--setopt",
  "--releasever",
  "--enablerepo",
  "--disablerepo",
  "--repo",
  "--exclude",
  "-x",
  "--cache-dir",
]);

function rpmCommand(tokens: string[]) {
  const { name, args } = directCommand(tokens);
  if (!Object.hasOwn(defaultPaths, name)) {
    return undefined;
  }
  let paths = defaultPaths[name];
  let cachedir: string | undefined;
  let systemCachedir: string | undefined;
  if (
    !paths ||
    args.some((arg) =>
      /^(?:--help|--version|--dry-run|--assumeno|-h|--config|-c|--installroot|--root|-R|--raw-cache-dir|--solv-cache-dir|--pkg-cache-dir)(?:=|$)/.test(
        arg,
      ),
    )
  ) {
    return undefined;
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const option = arg.split("=", 1)[0]!;
    if (option === "--setopt" || option === "--cache-dir") {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : (args[++index] ?? "");
      const cache =
        option === "--cache-dir" && name === "zypper"
          ? value
          : /^(?:cachedir|system_cachedir)=/.test(value)
            ? value.slice(value.indexOf("=") + 1)
            : undefined;
      if (cache !== undefined) {
        if (!cache.startsWith("/") || /[$`*?]/.test(cache)) {
          return undefined;
        }
        if (value.startsWith("system_cachedir=")) {
          systemCachedir = path.posix.normalize(cache);
        } else {
          cachedir = path.posix.normalize(cache);
        }
      }
      if (value.startsWith("tsflags=") && value.slice(8).split(",").includes("test")) {
        return undefined;
      }
    }
  }
  if (name === "dnf") {
    // DNF5 root uses system_cachedir, not the regular-user cachedir option.
    paths = [...new Set([cachedir ?? "/var/cache/dnf", systemCachedir ?? "/var/cache/libdnf5"])];
  } else if (cachedir) {
    paths = [cachedir];
  }
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const arg = args[index]!;
    index += valueOptions.has(arg) ? 2 : 1;
  }
  const action = args[index];
  const parameters = args.slice(index + 1);
  const clean =
    name === "zypper"
      ? /^(?:clean|cc)$/.test(action ?? "") &&
        parameters.some((arg) => arg === "--all" || /^-[a-z]*a[a-z]*$/i.test(arg)) &&
        parameters.every((arg) => arg.startsWith("-"))
      : action === "clean" &&
        parameters.includes("all") &&
        !args.some((arg) => /^(?:--enablerepo|--disablerepo|--repo)(?:=|$)/.test(arg));
  return {
    name,
    paths,
    install:
      (/^(?:install|in)$/.test(action ?? "") ||
        (name === "dnf" &&
          /^(?:upgrade|up|upgrade-minimal|up-min|reinstall|rei)$/.test(action ?? ""))) &&
      !(name === "zypper" && parameters.includes("-D")),
    clean,
  };
}

export function collectRpmCacheDiagnostics(
  repository: RepositorySignals,
  dockerfilePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const offenders: { line: number; tools: string[] }[] = [];
  const cleanupEvidence: string[] = [];
  for (const instruction of instructions) {
    const pending = new Map<string, string[]>();
    for (const tokens of dockerRunCommands(instruction)) {
      const command = rpmCommand(tokens);
      if (command?.install) {
        const retainedPaths = command.paths.filter(
          (cache) => !cacheIsMounted(cache, instruction, ["cache", "tmpfs"]),
        );
        if (retainedPaths.length) {
          pending.set(`${command.name}:${command.paths.join(",")}`, retainedPaths);
        }
      }
      for (const [key, paths] of pending) {
        const nativeCleanup =
          command?.clean && key === `${command.name}:${command.paths.join(",")}`;
        const remainingPaths = paths.filter(
          (cache) => !removesDirectory(tokens, cache, instruction.text),
        );
        if (nativeCleanup || !remainingPaths.length) {
          pending.delete(key);
        } else {
          pending.set(key, remainingPaths);
        }
      }
    }
    if (pending.size) {
      for (const [key, paths] of pending) {
        const tool = key.split(":", 1)[0];
        cleanupEvidence.push(
          describeLaterCacheCleanup(instructions, instruction, paths, (commands, cache) =>
            commands.some((tokens) => {
              const command = rpmCommand(tokens);
              return (
                command !== undefined &&
                command.name === tool &&
                command.clean &&
                command.paths.includes(cache)
              );
            }),
          ),
        );
      }
      offenders.push({
        line: instruction.startLine,
        tools: [...new Set([...pending.keys()].map((key) => key.split(":", 1)[0]!))],
      });
    }
  }
  if (!offenders.length) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: dockerfilePath, line: offenders[0]!.line, column: 1 },
      message: `Dockerfile ${dockerfilePath} retains RPM package metadata/cache after installs: ${offenders.map(({ line, tools }) => `line ${line}: ${tools.join(", ")}`).join("; ")}.${cleanupEvidence.join("")}`,
      why: "RPM package managers can leave repository metadata and downloaded cache data in output image layers. Later-layer cleanup cannot reclaim those bytes, increasing image storage, push, pull and extraction work.",
      suggestion:
        "Run the matching yum/dnf/microdnf clean all or zypper clean --all after the last install in the same RUN, or mount the effective cache directories with BuildKit. Preserve intentional package-cache reuse outside image layers.",
      measurementHint:
        "Compare output image layer size and cold and warm Docker build, push and pull times after cleaning or externally mounting RPM metadata/cache.",
      aiHandoff: `Review RPM installs in ${dockerfilePath} at lines ${offenders.map(({ line }) => line).join(", ")}. Clean the same manager's effective cache after the last install in the same RUN or mount its full cache paths. Preserve package versions, install options, stage inheritance and rebuild reuse.`,
      score: 72,
    }),
  ];
}
