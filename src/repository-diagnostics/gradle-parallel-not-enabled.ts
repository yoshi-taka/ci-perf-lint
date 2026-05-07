import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "gradle-parallel-not-enabled",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/gradle-parallel-not-enabled.md",
} satisfies RuleMeta;

const GRADLE_BUILD_FILE = /^build\.gradle(?:\.kts)?$/;

const GRADLE_LIFECYCLE = /\b(?:gradle|gradlew)\b.*\b(?:build|check|test|assemble|publish)\b/i;

const PARALLEL_FLAG = /--parallel\b/;

async function hasParallelInProperties(
  context: RepositoryScanContext,
): Promise<"enabled" | "disabled" | "absent"> {
  const text = await context.readTextFileOrWarn(context.resolve("gradle.properties"));
  if (!text) {
    return "absent";
  }
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) {
      continue;
    }
    const m = trimmed.match(/^org\.gradle\.parallel\s*=\s*(.+)$/);
    if (m) {
      return m[1]!.trim().toLowerCase() === "true" ? "enabled" : "disabled";
    }
  }
  return "absent";
}

async function countBuildFiles(context: RepositoryScanContext): Promise<number> {
  try {
    const entries = await context.readDirectoryEntries(context.repoRoot);
    let count = 0;
    const subdirs: string[] = [];
    for (const e of entries) {
      if (GRADLE_BUILD_FILE.test(e.name)) {
        count++;
      }
      if (
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        e.name !== "build" &&
        e.name !== "node_modules"
      ) {
        subdirs.push(e.name);
      }
    }
    for (const dir of subdirs) {
      const subEntries = await context
        .readDirectoryEntries(path.join(context.repoRoot, dir))
        .catch(() => undefined);
      if (subEntries) {
        for (const e of subEntries) {
          if (GRADLE_BUILD_FILE.test(e.name)) {
            count++;
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function ciUsesGradleLifecycle(workflows: WorkflowDocument[]): boolean {
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (GRADLE_LIFECYCLE.test(run)) {
          return true;
        }
      }
    }
  }
  return false;
}

function ciUsesParallelFlag(workflows: WorkflowDocument[]): boolean {
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (!GRADLE_LIFECYCLE.test(run)) {
          continue;
        }
        if (PARALLEL_FLAG.test(run)) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function collectGradleParallelNotEnabledDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.frameworks.usesGradle) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (!ciUsesGradleLifecycle(workflows)) {
    return [];
  }

  const parallelState = await hasParallelInProperties(context);
  if (parallelState === "enabled") {
    return [];
  }
  if (parallelState === "disabled") {
    return [];
  }

  if (ciUsesParallelFlag(workflows)) {
    return [];
  }

  const buildFileCount = await countBuildFiles(context);
  if (buildFileCount < 2) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: "gradle.properties",
        line: 1,
        column: 1,
      },
      message: "Gradle parallel build is not enabled for a likely multi-project build.",
      why: "Gradle can execute independent modules in parallel, reducing CI wall-clock time. This repository has multiple build.gradle files but org.gradle.parallel is not configured.",
      suggestion:
        "Add org.gradle.parallel=true to gradle.properties. If any modules share mutable state, verify parallel safety before enabling.",
      measurementHint:
        "Compare total CI build duration before and after enabling parallel. The speedup depends on module count and task independence.",
      aiHandoff:
        "Add org.gradle.parallel=true to gradle.properties at the repository root. This allows Gradle to execute independent modules concurrently. If the project uses shared mutable state across modules, test thoroughly before rolling out.",
      score: 55,
    }),
  ];
}
