import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { collectDockerfileData, type DockerBuildTarget } from "./docker-build-targets.ts";

const meta = {
  id: "docker-cache-copy-path-mismatch",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/docker-cache-copy-path-mismatch.md",
} satisfies RuleMeta;

const COPY_PATTERN = /^copy\s+(?:--from=\S+\s+)?(?:--chown=\S+\s+)?(?:--chmod=\S+\s+)?\s*(\S+)\s+/i;

const GRADLE_MAVEN_FILES = new Map<string, string[]>([
  ["build.gradle", ["build.gradle.kts"]],
  ["build.gradle.kts", ["build.gradle"]],
  ["settings.gradle", ["settings.gradle.kts"]],
  ["settings.gradle.kts", ["settings.gradle"]],
]);

function parseCopySource(line: string): string | undefined {
  const m = line.match(COPY_PATTERN);
  if (!m) {
    return undefined;
  }
  const source = m[1]!;
  if (source.includes("$") || source.includes("{") || source.startsWith("--from=")) {
    return undefined;
  }
  return source;
}

function lookupCandidates(source: string): string[] | undefined {
  const basename = source.split("/").pop();
  if (!basename) {
    return undefined;
  }
  return GRADLE_MAVEN_FILES.get(basename);
}

export async function collectDockerCacheCopyPathMismatchDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  targets: DockerBuildTarget[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    if (seen.has(target.dockerfilePath)) {
      continue;
    }
    seen.add(target.dockerfilePath);

    const data = await collectDockerfileData(context, target.dockerfilePath);
    if (!data) {
      continue;
    }

    for (const instruction of data.instructions) {
      if (!/^copy\b/i.test(instruction.text)) {
        continue;
      }

      const source = parseCopySource(instruction.text);
      if (!source) {
        continue;
      }

      const candidates = lookupCandidates(source);
      if (!candidates) {
        continue;
      }

      const sourceFound = await context.pathExists(path.join(target.contextPath, source));
      if (sourceFound) {
        continue;
      }

      const dir = path.dirname(source);
      const matches: string[] = [];
      for (const alt of candidates) {
        const altPath = dir === "." ? alt : path.join(dir, alt);
        if (await context.pathExists(path.join(target.contextPath, altPath))) {
          matches.push(altPath);
        }
      }
      if (matches.length === 0) {
        continue;
      }

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: target.dockerfilePath,
            line: instruction.startLine,
            column: 1,
          },
          message: `Dockerfile copies ${source} but that file does not exist in the repository. Found ${matches.join(" or ")} instead.`,
          why: "The Dockerfile COPY instruction references a build configuration file that does not exist at the expected path. If this file is used to prime a dependency or build cache layer, the cache layer may not work as intended because the wrong filename will be copied.",
          suggestion: `Update the COPY path to match the actual file: ${matches.join(" or ")}.`,
          measurementHint:
            "Verify the Docker build cache layer is being reused by rebuilding after a clean cache and checking buildkit cache hits.",
          aiHandoff: `Review the COPY instruction at ${target.dockerfilePath}:${instruction.startLine}. The file ${source} does not exist in the repository${
            matches.length > 0 ? `; found ${matches.join(" or ")} instead` : ""
          }. Update the COPY path to match the actual filename, or adjust the repository layout if the file is expected to be generated earlier in the build.`,
          score: 65,
        }),
      );
    }
  }

  return diagnostics;
}
