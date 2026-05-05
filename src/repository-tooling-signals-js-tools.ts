import path from "node:path";
import { readdir } from "node:fs/promises";
import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
} from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findPackageJsonDependencyLocation(
  packageJsonText: string,
  dependencyName: string,
): { line: number; column: number } {
  const keyMatch = new RegExp(
    `"${dependencyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`,
  ).exec(packageJsonText);
  return lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
}

function countShellCommands(script: string): number {
  return script
    .split(/\r?\n|&&|\|\|/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function analyzeLintStagedConfig(value: unknown): {
  patternCount: number;
  commandCount: number;
} {
  if (typeof value === "string") {
    return { patternCount: 1, commandCount: 1 };
  }

  if (Array.isArray(value)) {
    return {
      patternCount: 1,
      commandCount: value.filter((entry) => typeof entry === "string" && entry.trim().length > 0)
        .length,
    };
  }

  if (!value || typeof value !== "object") {
    return { patternCount: 0, commandCount: 0 };
  }

  let patternCount = 0;
  let commandCount = 0;

  for (const entry of Object.values(value as Record<string, unknown>)) {
    patternCount += 1;
    if (typeof entry === "string") {
      commandCount += 1;
    } else if (Array.isArray(entry)) {
      commandCount += entry.filter(
        (command) => typeof command === "string" && command.trim().length > 0,
      ).length;
    }
  }

  return { patternCount, commandCount };
}

export async function collectJestSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["jest"]> {
  const packageJsonEntry = await context.loadPackageJson();
  if (!packageJsonEntry.value) {
    return {};
  }

  const packageJson = packageJsonEntry.value;
  const versionSpec =
    packageJsonDependencyVersionSpec(packageJson, "jest") ??
    packageJsonDependencyVersionSpec(packageJson, "@jest/core");
  const jsdomVersionSpec = packageJsonDependencyVersionSpec(packageJson, "jsdom");
  const jsdomEnvironmentVersionSpec = packageJsonDependencyVersionSpec(
    packageJson,
    "jest-environment-jsdom",
  );
  const parsedJestVersion = versionSpec ? parseSemverLikeVersionSpec(versionSpec) : {};
  const parsedJsdomVersion = jsdomVersionSpec ? parseSemverLikeVersionSpec(jsdomVersionSpec) : {};
  const parsedJsdomEnvironmentVersion = jsdomEnvironmentVersionSpec
    ? parseSemverLikeVersionSpec(jsdomEnvironmentVersionSpec)
    : {};

  return {
    versionSpec,
    major: parsedJestVersion.major,
    minor: parsedJestVersion.minor,
    jsdomVersionSpec,
    jsdomMajor: parsedJsdomVersion.major,
    jsdomEnvironmentVersionSpec,
    jsdomEnvironmentMajor: parsedJsdomEnvironmentVersion.major,
  };
}

export async function collectHuskySignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["husky"]> {
  const hookFiles: RepositorySignals["husky"]["hookFiles"] = [];
  let usesHusky = false;
  let usesLintStaged = false;
  let lintStagedPatternCount = 0;
  let lintStagedCommandCount = 0;
  const huskyDir = context.resolve(".husky");
  const huskyEntries = (await context.pathExists(huskyDir))
    ? await readdir(huskyDir, { withFileTypes: true }).catch(() => [])
    : [];
  const hookLoads = await Promise.all(
    huskyEntries.map(async (entry) => {
      if (!entry.isFile() || entry.name === ".gitignore") {
        return undefined;
      }

      const hookPath = path.join(huskyDir, entry.name);
      const content = await context.readTextFileOrWarn(hookPath);
      if (!content) {
        return undefined;
      }

      return {
        path: path.relative(context.repoRoot, hookPath),
        content,
      };
    }),
  );
  hookFiles.push(
    ...hookLoads.filter((hookFile): hookFile is RepositorySignals["husky"]["hookFiles"][number] =>
      Boolean(hookFile),
    ),
  );

  const hookFileCount = hookFiles.length;
  const nonPreCommitHookCount = hookFiles.filter(
    (hookFile) => path.basename(hookFile.path) !== "pre-commit",
  ).length;
  const perHookCommandCounts = hookFiles.map((hookFile) => countShellCommands(hookFile.content));
  const totalHookCommandCount = perHookCommandCounts.reduce((sum, count) => sum + count, 0);
  const multiCommandHookCount = perHookCommandCounts.filter((count) => count >= 2).length;

  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonRelativePath = normalizeRelativePath(context.repoRoot, packageJsonEntry.path);
  if (!packageJsonEntry.value) {
    return {
      usesHusky,
      usesLintStaged,
      hookFileCount,
      nonPreCommitHookCount,
      totalHookCommandCount,
      multiCommandHookCount,
      lintStagedPatternCount,
      lintStagedCommandCount,
      hookFiles,
    };
  }

  const packageJson = packageJsonEntry.value;
  usesHusky ||= packageJsonHasDependency(packageJson, "husky") || hookFileCount > 0;
  usesLintStaged ||= packageJsonHasDependency(packageJson, "lint-staged");
  if (packageJson["lint-staged"] !== undefined) {
    usesLintStaged = true;
    const lintStagedAnalysis = analyzeLintStagedConfig(packageJson["lint-staged"]);
    lintStagedPatternCount = lintStagedAnalysis.patternCount;
    lintStagedCommandCount = lintStagedAnalysis.commandCount;
  }
  const dependencySections = [
    packageJson.devDependencies,
    ...dependencySectionsOf(packageJson).filter(
      (section) => section !== packageJson.devDependencies,
    ),
  ];

  for (const section of dependencySections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    const versionSpec = (section as Record<string, unknown>).husky;
    if (typeof versionSpec !== "string" || versionSpec.trim().length === 0) {
      continue;
    }

    const versionLocation = packageJsonEntry.text
      ? findPackageJsonDependencyLocation(packageJsonEntry.text, "husky")
      : { line: 1, column: 1 };

    return {
      usesHusky,
      usesLintStaged,
      hookFileCount,
      nonPreCommitHookCount,
      totalHookCommandCount,
      multiCommandHookCount,
      lintStagedPatternCount,
      lintStagedCommandCount,
      versionSpec,
      ...parseSemverLikeVersionSpec(versionSpec),
      versionLocation: {
        path: packageJsonRelativePath,
        line: versionLocation.line,
        column: versionLocation.column,
      },
      hookFiles,
    };
  }

  return {
    usesHusky,
    usesLintStaged,
    hookFileCount,
    nonPreCommitHookCount,
    totalHookCommandCount,
    multiCommandHookCount,
    lintStagedPatternCount,
    lintStagedCommandCount,
    hookFiles,
  };
}
