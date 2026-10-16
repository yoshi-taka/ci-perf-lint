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
  id: "dockerfile-apt-install-without-cleanup-or-cache-mount",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/dockerfile-apt-install-without-cleanup-or-cache-mount.md",
} satisfies RuleMeta;
const listsPath = "/var/lib/apt/lists";

export function collectAptCacheDiagnostics(
  repository: RepositorySignals,
  dockerfilePath: string,
  instructions: CollectedDockerfileInstruction[],
): Diagnostic[] {
  const lines: number[] = [];
  const cleanupEvidence: string[] = [];
  for (const instruction of instructions) {
    if (cacheIsMounted(listsPath, instruction, ["cache", "tmpfs"])) {
      continue;
    }
    let pending = false;
    for (const tokens of dockerRunCommands(instruction)) {
      const { name, args } = directCommand(tokens);
      if (/^(?:apt(?:-get)?|aptitude)$/.test(name)) {
        if (
          args.some((arg) =>
            /^(?:--help|--version|--simulate|--just-print|--dry-run|--recon|--no-act|-s|-h|-c|--config-file)(?:=|$)/.test(
              arg,
            ),
          ) ||
          args.some((arg) => arg.includes("Dir::"))
        ) {
          continue;
        }
        let index = 0;
        while (args[index]?.startsWith("-")) {
          index += args[index] === "-o" || args[index] === "--option" ? 2 : 1;
        }
        if (/^(?:update|install)$/.test(args[index] ?? "")) {
          pending = true;
        }
      }
      if (removesDirectory(tokens, listsPath, instruction.text)) {
        pending = false;
      }
    }
    if (pending) {
      lines.push(instruction.startLine);
      cleanupEvidence.push(describeLaterCacheCleanup(instructions, instruction, [listsPath]));
    }
  }
  if (!lines.length) {
    return [];
  }
  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: dockerfilePath, line: lines[0]!, column: 1 },
      message: `Dockerfile ${dockerfilePath} runs apt package work without cleaning apt lists after it in the same layer or mounting the lists directory at lines ${lines.join(", ")}.${cleanupEvidence.join("")}`,
      why: "apt lists retained in an output stage increase image layer storage and transfer costs. Cleaning in a later RUN, or mounting only /var/cache/apt, does not remove lists already stored under /var/lib/apt/lists.",
      suggestion:
        "Clean /var/lib/apt/lists after apt update/install in the same RUN, or use a BuildKit cache mount covering /var/lib/apt/lists. Mount /var/cache/apt separately when downloaded package reuse matters.",
      measurementHint:
        "Compare image layer size and cold and warm Docker build times, including push and pull, after cleaning or mounting apt metadata.",
      aiHandoff: `Review apt package work at lines ${lines.join(", ")} in ${dockerfilePath}. Remove apt lists after the last update/install in the same RUN, or mount the effective lists path. Preserve package selection and verify output-stage inheritance and build targets.`,
      score: 73,
    }),
  ];
}
