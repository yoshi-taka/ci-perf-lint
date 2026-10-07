import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowStep } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { getNode, getScalarString } from "../workflow.ts";
import { workflowWorkingDirectory } from "../rules/shared/workflow-command-context.ts";
import { detectInstallCommandFromText } from "../rules/shared/tools.ts";
import { shellCommandSegments, staticShellWords } from "../rules/shared/command-patterns.ts";

const meta = {
  id: "setup-node-cache-dependency-path-unset",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/setup-node-cache-dependency-path-unset.md",
} satisfies RuleMeta;

const lockFileNames = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
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

function isNodeStepWithoutCacheDependencyPath(step: WorkflowStep): boolean {
  const withNode = step.withNode;
  if (!withNode) {
    return false;
  }
  const cacheValue = getScalarString(getNode(withNode, "cache"));
  if (!cacheValue) {
    return false;
  }
  const cacheDependencyPathValue = getScalarString(getNode(withNode, "cache-dependency-path"));
  if (cacheDependencyPathValue) {
    return false;
  }
  return true;
}

export async function collectSetupNodeCacheDependencyPathUnsetDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { repository, scanContext, predicateIndex } = context;

  const { hasOutside, lockFileTypes } = await findLockFilesOutsideRoot(scanContext);

  const diagnostics: Diagnostic[] = [];
  const nodeSteps = predicateIndex.bySetupActionKind.get("node");
  if (!nodeSteps) {
    return diagnostics;
  }

  for (const { workflow, job, step } of nodeSteps) {
    if (job.usesReusableWorkflow) {
      continue;
    }
    if (!isNodeStepWithoutCacheDependencyPath(step)) {
      continue;
    }
    const manager = getScalarString(getNode(step.withNode!, "cache"));
    const matchingNames =
      manager === "npm"
        ? ["package-lock.json", "npm-shrinkwrap.json"]
        : manager === "yarn"
          ? ["yarn.lock"]
          : manager === "pnpm"
            ? ["pnpm-lock.yaml"]
            : [];
    if (matchingNames.length === 0) {
      continue;
    }
    const checkout = job.steps.find((candidate) => candidate.uses?.startsWith("actions/checkout@"));
    const checkoutPath = checkout?.with?.path;
    if (
      checkoutPath !== undefined &&
      (typeof checkoutPath !== "string" || checkoutPath.includes("${{"))
    ) {
      continue;
    }
    const rootCheckout = checkoutPath === undefined || checkoutPath === ".";
    const rootLock = (
      await Promise.all(
        matchingNames.map((name) => scanContext.pathExists(scanContext.resolve(name))),
      )
    ).some(Boolean);
    const nestedInstallLocks = await Promise.all(
      job.steps
        .filter((candidate) => detectInstallCommandFromText(candidate.run ?? "") === manager)
        .map(async (candidate) => {
          let cwd = workflowWorkingDirectory(workflow, job, candidate);
          for (const command of shellCommandSegments(candidate.run ?? "")) {
            const words = staticShellWords(command);
            if (words?.[0] === "cd" && words[1]) {
              cwd = path.posix.join(cwd, words[1]);
              continue;
            }
            if (
              detectInstallCommandFromText(command) !== manager ||
              cwd === "." ||
              cwd.includes("${{") ||
              path.isAbsolute(cwd) ||
              cwd.startsWith("..")
            ) {
              continue;
            }
            if (
              (
                await Promise.all(
                  matchingNames.map((name) =>
                    scanContext.pathExists(scanContext.resolve(cwd, name)),
                  ),
                )
              ).some(Boolean)
            ) {
              return true;
            }
          }
          return false;
        }),
    );
    if (rootCheckout && rootLock && !nestedInstallLocks.some(Boolean)) {
      continue;
    }
    if (!hasOutside && !(rootLock && !rootCheckout)) {
      continue;
    }
    if (!rootLock && !matchingNames.some((name) => lockFileTypes.has(name))) {
      continue;
    }
    const matchingLockNames = matchingNames.filter((name) => lockFileTypes.has(name));
    const lockFileGlob =
      !rootCheckout && typeof checkoutPath === "string"
        ? path.posix.join(checkoutPath, matchingLockNames[0] ?? matchingNames[0]!)
        : matchingLockNames.length === 1
          ? `**/${matchingLockNames[0]}`
          : `**/{${matchingLockNames.join(",")}}`;
    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: workflow.relativePath,
          line: step.usesNode?.range
            ? (workflow.lineCounter?.linePos(step.usesNode.range[0]).line ?? 1)
            : 1,
          column: step.usesNode?.range
            ? (workflow.lineCounter?.linePos(step.usesNode.range[0]).col ?? 1)
            : 1,
        },
        message: `Job "${job.id}" uses actions/setup-node with cache enabled but without cache-dependency-path in ${workflow.relativePath}, ${rootCheckout ? "even though relevant lock files exist outside the repository root" : "even though checkout places the lock file outside the workspace root"}.`,
        why: "In monorepos or multi-package repositories, setup-node cannot reliably locate lock files that live outside the root directory. Without cache-dependency-path, the caching step may miss the correct dependency manifest and produce cache misses or invalid caches.",
        suggestion: `Add cache-dependency-path to the setup-node step, e.g. \`cache-dependency-path: "${lockFileGlob}"\` or point it to the actual lock file paths.`,
        measurementHint:
          "Compare cache hit rate before and after adding cache-dependency-path in CI job metrics.",
        aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add the appropriate cache-dependency-path value to the actions/setup-node step so the cache key includes the correct lock file(s).`,
        score: 50,
      }),
    );
  }

  return diagnostics;
}
