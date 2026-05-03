import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { getSetupActionKind } from "../rules/shared/workflow-setup-actions.ts";
import { getNode, getScalarString } from "../workflow.ts";

const meta = {
  id: "setup-node-cache-dependency-path-unset",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/setup-node-cache-dependency-path-unset.md",
} satisfies RuleMeta;

const lockFileNames = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
]);

async function findLockFilesOutsideRoot(context: RepositoryScanContext): Promise<{
  hasOutside: boolean;
  lockFileTypes: Set<string>;
}> {
  const files = await context.walkFiles(".", {
    cacheKey: "subdirectory-lock-files",
    ignoredDirectories: new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".turbo",
      "coverage",
      ".nuxt",
      "out",
      "public",
    ]),
    include: (relativePath) => lockFileNames.has(path.basename(relativePath)),
  });
  const lockFileTypes = new Set<string>();
  for (const f of files) {
    const base = path.basename(f);
    if (lockFileNames.has(base)) {
      lockFileTypes.add(base);
    }
  }
  return { hasOutside: files.some((f) => f.includes("/")), lockFileTypes };
}

function getSetupNodeStepsWithoutCacheDependencyPath(
  workflow: WorkflowDocument,
): { job: WorkflowJob; step: WorkflowStep }[] {
  const results: { job: WorkflowJob; step: WorkflowStep }[] = [];

  for (const job of workflow.jobs) {
    if (job.usesReusableWorkflow) {
      continue;
    }
    for (const step of job.steps) {
      if (getSetupActionKind(step) !== "node") {
        continue;
      }
      const withNode = step.withNode;
      if (!withNode) {
        continue;
      }
      const cacheValue = getScalarString(getNode(withNode, "cache"));
      if (!cacheValue) {
        continue;
      }
      const cacheDependencyPathValue = getScalarString(getNode(withNode, "cache-dependency-path"));
      if (cacheDependencyPathValue) {
        continue;
      }
      results.push({ job, step });
    }
  }

  return results;
}

export async function collectSetupNodeCacheDependencyPathUnsetDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const { hasOutside, lockFileTypes } = await findLockFilesOutsideRoot(context);
  if (!hasOutside) {
    return [];
  }

  const lockFileGlob =
    lockFileTypes.size === 1
      ? `**/${[...lockFileTypes][0]}`
      : `**/{${[...lockFileTypes].join(",")}}`;

  const diagnostics: Diagnostic[] = [];

  for (const workflow of workflows) {
    const steps = getSetupNodeStepsWithoutCacheDependencyPath(workflow);

    for (const { job, step } of steps) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: workflow.relativePath,
            line: step.usesNode?.range
              ? workflow.lineCounter!.linePos(step.usesNode.range[0]).line
              : 1,
            column: step.usesNode?.range
              ? workflow.lineCounter!.linePos(step.usesNode.range[0]).col
              : 1,
          },
          message: `Job "${job.id}" uses actions/setup-node with cache enabled but without cache-dependency-path in ${workflow.relativePath}, even though lock files exist outside the repository root.`,
          why: "In monorepos or multi-package repositories, setup-node cannot reliably locate lock files that live outside the root directory. Without cache-dependency-path, the caching step may miss the correct dependency manifest and produce cache misses or invalid caches.",
          suggestion: `Add cache-dependency-path to the setup-node step, e.g. \`cache-dependency-path: "${lockFileGlob}"\` or point it to the actual lock file paths.`,
          measurementHint:
            "Compare cache hit rate before and after adding cache-dependency-path in CI job metrics.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add the appropriate cache-dependency-path value to the actions/setup-node step so the cache key includes the correct lock file(s).`,
          score: 50,
        }),
      );
    }
  }

  return diagnostics;
}
