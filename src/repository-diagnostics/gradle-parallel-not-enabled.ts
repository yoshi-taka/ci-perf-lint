import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import {
  collectGradleCommands,
  findGradleBuildRoot,
  gradleParallelProperty,
} from "../rules/shared/gradle-commands.ts";
import {
  workflowStepEnv,
  workflowWorkingDirectory,
} from "../rules/shared/workflow-command-context.ts";

const meta = {
  id: "gradle-parallel-not-enabled",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/gradle-parallel-not-enabled.md",
} satisfies RuleMeta;

const GRADLE_BUILD_FILE = /^build\.gradle(?:\.kts)?$/;

async function hasParallelInProperties(
  scanContext: RepositoryScanContext,
  root = ".",
): Promise<"enabled" | "disabled" | "unknown" | "absent"> {
  const filePath = scanContext.resolve(root, "gradle.properties");
  const text = (await scanContext.pathExists(filePath))
    ? await scanContext.readTextFileOrWarn(filePath)
    : undefined;
  if (!text) {
    return "absent";
  }
  return gradleParallelProperty(text);
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

  const untunedRoots = new Set<string>();
  for (const { workflow, job, step } of context.predicateIndex.allSteps) {
    for (const command of collectGradleCommands(
      step.run ?? "",
      workflowStepEnv(workflow, job, step),
      workflowWorkingDirectory(workflow, job, step),
    )) {
      if (!command.lifecycle || command.parallelConfigured || command.userHome === null) {
        continue;
      }
      const root = await findGradleBuildRoot(context.scanContext, command.directory);
      if (root === undefined) {
        continue;
      }
      if (
        command.userHome &&
        (await hasParallelInProperties(context.scanContext, command.userHome)) !== "absent"
      ) {
        continue;
      }
      if ((await hasParallelInProperties(context.scanContext, root)) === "absent") {
        untunedRoots.add(root);
      }
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const root of [...untunedRoots].sort()) {
    if ((await countBuildFiles(context.scanContext, root)) < 2) {
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
