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
import { collectCommandEntries } from "../rules/shared/any-step.ts";

const meta = {
  id: "gradle-parallel-not-enabled",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/gradle-parallel-not-enabled.md",
} satisfies RuleMeta;

const GRADLE_BUILD_FILE = /^build\.gradle(?:\.kts)?$/;
const GRADLE_SETTINGS_FILES = ["settings.gradle", "settings.gradle.kts"] as const;
const GRADLE_INCLUDE_DECLARATION = /\binclude\s*(?:\(([\s\S]*?)\)|([^\n;]+))/g;
const GRADLE_QUOTED_VALUE = /["']([^"']+)["']/g;
const SKIPPED_MODULE_DIRS = new Set([
  "build",
  "buildSrc",
  "build-logic",
  "node_modules",
  ".git",
  ".gradle",
]);
const MAX_MODULE_DIRECTORIES = 2_000;

function stripGradleComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function includedModuleNames(settingsText: string): string[] {
  const modules = new Set<string>();
  const text = stripGradleComments(settingsText);
  for (const declaration of text.matchAll(GRADLE_INCLUDE_DECLARATION)) {
    for (const match of (declaration[1] ?? declaration[2] ?? "").matchAll(GRADLE_QUOTED_VALUE)) {
      const module = match[1]!.replace(/^:/, "").replace(/:/g, "/");
      if (!module || module === "buildSrc" || module.startsWith("buildSrc/")) {
        continue;
      }
      if (module === "build-logic" || module.startsWith("build-logic/")) {
        continue;
      }
      modules.add(module);
    }
  }
  return [...modules];
}

async function countModulesFromSettings(
  scanContext: RepositoryScanContext,
  root: string,
): Promise<number | undefined> {
  for (const fileName of GRADLE_SETTINGS_FILES) {
    const filePath = scanContext.resolve(root, fileName);
    if (!(await scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await scanContext.readTextFileOrWarn(filePath);
    if (text === undefined) {
      continue;
    }
    // The root project participates in a Gradle build even when it has no
    // include entry of its own.
    return includedModuleNames(text).length + 1;
  }
  return undefined;
}

async function countBuildFilesRecursive(
  scanContext: RepositoryScanContext,
  root: string,
  directoryBudget = { remaining: MAX_MODULE_DIRECTORIES },
): Promise<number> {
  if (directoryBudget.remaining <= 0) {
    return 0;
  }
  directoryBudget.remaining--;
  let entries;
  try {
    entries = await scanContext.readDirectoryEntries(scanContext.resolve(root));
  } catch {
    return 0;
  }

  let count = 0;
  const subdirs: string[] = [];
  for (const entry of entries) {
    if (GRADLE_BUILD_FILE.test(entry.name)) {
      count++;
    }
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !SKIPPED_MODULE_DIRS.has(entry.name)
    ) {
      subdirs.push(entry.name);
    }
  }
  for (const dir of subdirs) {
    count += await countBuildFilesRecursive(
      scanContext,
      path.posix.join(root, dir),
      directoryBudget,
    );
  }
  return count;
}

async function countGradleModules(
  scanContext: RepositoryScanContext,
  root: string,
): Promise<number> {
  const settingsCount = await countModulesFromSettings(scanContext, root);
  if (settingsCount !== undefined) {
    return settingsCount;
  }
  return countBuildFilesRecursive(scanContext, root);
}

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

export async function collectGradleParallelNotEnabledDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (!context.repository.frameworks.usesGradle) {
    return [];
  }

  const untunedRoots = new Set<string>();
  const considerCommand = async (
    text: string,
    environment: Record<string, unknown>,
    directory: string | undefined,
  ): Promise<void> => {
    for (const command of collectGradleCommands(text, environment, directory)) {
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
  };

  for (const { workflow, job, step } of context.predicateIndex.allSteps) {
    await considerCommand(
      step.run ?? "",
      workflowStepEnv(workflow, job, step),
      workflowWorkingDirectory(workflow, job, step),
    );
  }
  for (const document of context.documents ?? []) {
    if (document.kind === "github-actions") {
      continue;
    }
    for (const entry of collectCommandEntries(document)) {
      await considerCommand(entry.text, {}, entry.workingDirectory);
    }
  }
  const diagnostics: Diagnostic[] = [];
  for (const root of [...untunedRoots].sort()) {
    if ((await countGradleModules(context.scanContext, root)) < 2) {
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
