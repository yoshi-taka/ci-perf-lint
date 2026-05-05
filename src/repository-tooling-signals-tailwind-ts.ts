import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
  parseTypeScriptVersionSpec,
} from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

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

function textMentionsLegacyBrowserTargets(text: string): boolean {
  return /\b(?:ie\s+\d|internet explorer|op_mini|safari\s+(?:[0-9]|1[0-5]|16\.[0-3])|chrome\s+(?:[0-9]{1,2}|10[0-9]|110)|firefox\s+(?:[0-9]{1,2}|1[01][0-9]|12[0-7]))\b/i.test(
    text,
  );
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
