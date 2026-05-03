import path from "node:path";
import { readdir } from "node:fs/promises";
import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
  parseTypeScriptVersionSpec,
} from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

export { collectBabelSignals } from "./repository-tooling-signals-babel.ts";
export {
  collectEslintSignals,
  collectPrettierSignals,
} from "./repository-tooling-signals-eslint.ts";

const pythonToolSignalFileNames = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "setup.cfg",
  "tox.ini",
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
] as const;

const tailwindConfigFileNames = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.cts",
  "tailwind.config.mts",
] as const;

const postcssConfigFileNames = [
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
] as const;

const nativeHeavyNodePackages = [
  "sharp",
  "canvas",
  "sqlite3",
  "better-sqlite3",
  "esbuild",
] as const;

const nativeHeavyPythonPackages = ["cryptography", "lxml", "orjson"] as const;

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
    `"${dependencyName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"\\s*:`,
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

async function loadExistingTextFiles(
  context: RepositoryScanContext,
  fileNames: readonly string[],
): Promise<{ fileName: string; text: string }[]> {
  const loads = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = context.resolve(fileName);
      if (!(await context.pathExists(filePath))) {
        return undefined;
      }

      const text = await context.readTextFileOrWarn(filePath);
      if (!text) {
        return undefined;
      }

      return { fileName, text };
    }),
  );

  return loads.filter((entry): entry is { fileName: string; text: string } => Boolean(entry));
}

function textMentionsLegacyBrowserTargets(text: string): boolean {
  return /\b(?:ie\s+\d|internet explorer|op_mini|safari\s+(?:[0-9]|1[0-5]|16\.[0-3])|chrome\s+(?:[0-9]{1,2}|10[0-9]|110)|firefox\s+(?:[0-9]{1,2}|1[01][0-9]|12[0-7]))\b/i.test(
    text,
  );
}

export async function collectTailwindSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["tailwind"]> {
  let usesTailwind = false;
  let versionSpec: string | undefined;
  let hasConfig = false;
  let usesConfigPlugins = false;
  let usesPostcssPlugin = false;
  let usesVitePlugin = false;
  let usesCliPackage = false;
  let hasLegacyBrowserTargets = false;

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text && packageJsonEntry.value) {
    const packageJsonText = packageJsonEntry.text;
    const packageJson = packageJsonEntry.value;
    versionSpec = packageJsonDependencyVersionSpec(packageJson, "tailwindcss");
    usesTailwind ||= Boolean(versionSpec);
    usesPostcssPlugin ||= packageJsonHasDependency(packageJson, "@tailwindcss/postcss");
    usesVitePlugin ||= packageJsonHasDependency(packageJson, "@tailwindcss/vite");
    usesCliPackage ||= packageJsonHasDependency(packageJson, "@tailwindcss/cli");
    usesTailwind ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\btailwindcss\b/i.test(packageJsonText);
    hasLegacyBrowserTargets ||= textMentionsLegacyBrowserTargets(packageJsonText);
  }

  const tailwindConfigFiles = await loadExistingTextFiles(context, tailwindConfigFileNames);
  for (const { text: configText } of tailwindConfigFiles) {
    hasConfig = true;
    usesTailwind = true;
    usesConfigPlugins ||=
      /\bplugins\s*:\s*\[[\s\S]*?\S[\s\S]*?\]|\brequire\s*\(\s*["']@tailwindcss\//i.test(
        configText,
      );
  }

  const postcssConfigFiles = await loadExistingTextFiles(context, postcssConfigFileNames);
  for (const { text: configText } of postcssConfigFiles) {
    if (/\btailwindcss\b/i.test(configText)) {
      usesTailwind = true;
      usesPostcssPlugin = true;
    }
  }

  const browserslistPath = context.resolve(".browserslistrc");
  if (await context.pathExists(browserslistPath)) {
    const browserslistText = await context.readTextFileOrWarn(browserslistPath);
    hasLegacyBrowserTargets ||= Boolean(
      browserslistText && textMentionsLegacyBrowserTargets(browserslistText),
    );
  }

  const parsedVersion = versionSpec ? parseSemverLikeVersionSpec(versionSpec) : {};

  return {
    usesTailwind,
    versionSpec,
    major: parsedVersion.major,
    minor: parsedVersion.minor,
    hasConfig,
    usesConfigPlugins,
    usesPostcssPlugin,
    usesVitePlugin,
    usesCliPackage,
    hasLegacyBrowserTargets,
  };
}

export async function collectPythonSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["python"]> {
  let usesBlack = false;
  let usesIsort = false;
  let usesRuff = false;
  let usesTox = false;
  let usesNox = false;

  const signalFiles = await loadExistingTextFiles(context, pythonToolSignalFileNames);
  for (const { text: signalText } of signalFiles) {
    usesBlack ||= /\bblack\b|\[tool\.black\]/i.test(signalText);
    usesIsort ||= /\bisort\b|\[tool\.isort\]/i.test(signalText);
    usesRuff ||= /\bruff\b|\[tool\.ruff(?:\.[^\]]+)?\]/i.test(signalText);
    usesTox ||= /(?:^|\s)\[tox\]|\[tool\.tox\]|requires\s*=.*\btox\b|deps\s*=.*\btox\b/i.test(
      signalText,
    );
    usesNox ||= /\bnox\b/i.test(signalText);
  }

  if (!usesNox) {
    usesNox = await context.pathExists(context.resolve("noxfile.py")).catch(() => false);
  }

  return {
    usesBlack,
    usesIsort,
    usesRuff,
    usesTox,
    usesNox,
  };
}

const hatchConfigFileNames = ["pyproject.toml", "hatch.toml"] as const;

export async function collectHatchSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["hatch"]> {
  let usesHatch = false;
  let usesUvInstaller = false;

  const signalFiles = await loadExistingTextFiles(context, hatchConfigFileNames);
  for (const { text: signalText } of signalFiles) {
    usesHatch ||= /\[tool\.hatch(?:\.[^\]]+)?\]|^\[env\]|^\[hatch\./im.test(signalText);
    if (usesHatch) {
      usesUvInstaller ||= /installer\s*=\s*["']uv["']/i.test(signalText);
    }
  }

  return { usesHatch, usesUvInstaller };
}

const pdmConfigFileNames = ["pyproject.toml", "pdm.toml"] as const;

export async function collectPdmSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["pdm"]> {
  let usesPdm = false;
  let usesUv = false;

  const signalFiles = await loadExistingTextFiles(context, pdmConfigFileNames);
  for (const { text: signalText } of signalFiles) {
    usesPdm ||= /\[tool\.pdm\]|^\[pdm\]/im.test(signalText);
    if (usesPdm) {
      usesUv ||= /use_uv\s*=\s*true/i.test(signalText);
    }
  }

  return { usesPdm, usesUv };
}

export async function collectNativePackageSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["nativePackages"]> {
  const node = new Set<string>();
  const python = new Set<string>();

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.value) {
    const packageJson = packageJsonEntry.value;
    for (const section of dependencySectionsOf(packageJson)) {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }

      for (const packageName of nativeHeavyNodePackages) {
        if (typeof (section as Record<string, unknown>)[packageName] === "string") {
          node.add(packageName);
        }
      }
    }
  }

  const signalFiles = await loadExistingTextFiles(context, pythonToolSignalFileNames);
  for (const { text: signalText } of signalFiles) {
    for (const packageName of nativeHeavyPythonPackages) {
      if (new RegExp(`\\b${packageName}\\b`, "i").test(signalText)) {
        python.add(packageName);
      }
    }
  }

  return {
    node: [...node].sort(),
    python: [...python].sort(),
  };
}

export async function collectTypeScriptSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["typescript"]> {
  const packageJsonEntry = await context.loadPackageJson();
  if (!packageJsonEntry.value) {
    return { isPublishingTypeDefinitions: false };
  }

  const packageJson = packageJsonEntry.value;
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

    const versionSpec = (section as Record<string, unknown>).typescript;
    if (typeof versionSpec !== "string" || versionSpec.trim().length === 0) {
      continue;
    }

    return {
      versionSpec,
      ...parseTypeScriptVersionSpec(versionSpec),
      isPublishingTypeDefinitions:
        typeof packageJson.types === "string" || typeof packageJson.typings === "string",
    };
  }

  return { isPublishingTypeDefinitions: false };
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

function countCargoWorkspaceMembers(cargoTomlText: string): number | undefined {
  const workspaceMembersMatch = cargoTomlText.match(
    /\[workspace\][\s\S]*?\bmembers\s*=\s*\[([\s\S]*?)\]/,
  );
  if (!workspaceMembersMatch?.[1]) {
    return undefined;
  }

  const members = workspaceMembersMatch[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));

  return members.length;
}

export async function collectElixirSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["elixir"]> {
  const mixExsPath = context.resolve("mix.exs");
  const hasMixExs = await context.pathExists(mixExsPath);

  const toolVersionsPath = context.resolve(".tool-versions");
  const toolVersionsText = (await context.pathExists(toolVersionsPath))
    ? await context.readTextFileOrWarn(toolVersionsPath)
    : undefined;

  let hasToolVersions = false;
  let erlangVersion: string | undefined;
  let elixirVersion: string | undefined;

  if (toolVersionsText) {
    hasToolVersions = true;
    for (const line of toolVersionsText.split("\n")) {
      const trimmed = line.trim();
      const erlangMatch = trimmed.match(/^erlang\s+(\S+)/);
      if (erlangMatch) {
        erlangVersion = erlangMatch[1];
        continue;
      }
      const elixirMatch = trimmed.match(/^elixir\s+(\S+)/);
      if (elixirMatch) {
        elixirVersion = elixirMatch[1];
      }
    }
  }

  return { hasMixExs, hasToolVersions, erlangVersion, elixirVersion };
}

export async function collectRustSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["rust"]> {
  const cargoTomlPath = context.resolve("Cargo.toml");
  const hasCargoToml = await context.pathExists(cargoTomlPath);
  const cargoTomlText = hasCargoToml ? await context.readTextFileOrWarn(cargoTomlPath) : undefined;
  const nextestConfigPresent =
    (await context.pathExists(context.resolve(".config", "nextest.toml"))) ||
    (await context.pathExists(context.resolve("nextest.toml")));

  return {
    hasCargoToml,
    hasWorkspace: (cargoTomlText ?? "").includes("[workspace]"),
    workspaceMemberCount: cargoTomlText ? countCargoWorkspaceMembers(cargoTomlText) : undefined,
    usesNextest: nextestConfigPresent || /\bnextest\b/i.test(cargoTomlText ?? ""),
  };
}
