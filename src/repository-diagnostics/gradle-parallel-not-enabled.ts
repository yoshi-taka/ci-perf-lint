import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";

const meta = {
  id: "gradle-parallel-not-enabled",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/gradle-parallel-not-enabled.md",
} satisfies RuleMeta;

const GRADLE_BUILD_FILE = /^build\.gradle(?:\.kts)?$/;

const GRADLE_LIFECYCLE = /\b(?:gradle|gradlew)\b.*\b(?:build|check|test|assemble|publish)\b/i;

const PARALLEL_FLAG = /--(?:no-)?parallel\b/;

async function hasParallelInProperties(
  scanContext: RepositoryScanContext,
  root = ".",
): Promise<"enabled" | "disabled" | "absent"> {
  const filePath = scanContext.resolve(root, "gradle.properties");
  const text = (await scanContext.pathExists(filePath))
    ? await scanContext.readTextFileOrWarn(filePath)
    : undefined;
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

async function countBuildFiles(scanContext: RepositoryScanContext, root = "."): Promise<number> {
  try {
    const entries = await scanContext.readDirectoryEntries(scanContext.resolve(root));
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
      const subEntries = await scanContext
        .readDirectoryEntries(scanContext.resolve(root, dir))
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

export async function collectGradleParallelNotEnabledDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (!context.repository.frameworks.usesGradle) {
    return [];
  }

  let hasGradleLifecycle = false;
  let hasParallelFlag = false;
  for (const { step } of context.predicateIndex.allSteps) {
    const run = step.run ?? "";
    const isLifecycle = GRADLE_LIFECYCLE.test(run);
    if (isLifecycle) {
      hasGradleLifecycle = true;
      if (PARALLEL_FLAG.test(run)) {
        hasParallelFlag = true;
        break;
      }
    }
  }

  if (!hasGradleLifecycle) {
    return [];
  }

  if (hasParallelFlag) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  for (const root of context.repository.jvm.buildRoots ?? ["."]) {
    const parallelState = await hasParallelInProperties(context.scanContext, root);
    if (parallelState !== "absent" || (await countBuildFiles(context.scanContext, root)) < 2) {
      continue;
    }
    diagnostics.push(
      buildRepositoryDiagnostic(context.repository, meta, {
        location: {
          path: path.posix.join(root, "gradle.properties"),
          line: 1,
          column: 1,
        },
        message: "Gradle parallel build is not enabled for a likely multi-project build.",
        why: "Gradle can execute independent modules in parallel, reducing CI wall-clock time. This repository has multiple build.gradle files but org.gradle.parallel is not configured.",
        suggestion:
          "Add org.gradle.parallel=true to gradle.properties. If any modules share mutable state, verify parallel safety before enabling.",
        measurementHint:
          "Compare total CI build duration before and after enabling parallel. The speedup depends on module count and task independence.",
        aiHandoff: `Add org.gradle.parallel=true to ${path.posix.join(root, "gradle.properties")}. This allows Gradle to execute independent modules concurrently. If the project uses shared mutable state across modules, test thoroughly before rolling out.`,
        score: 55,
      }),
    );
  }
  return diagnostics;
}
