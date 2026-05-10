import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
} from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

const nextConfigFileNames = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
  "next.config.cts",
] as const;
const viteConfigFileNames = [
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
] as const;
const astroConfigFileNames = [
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.mts",
] as const;
const svelteConfigFileNames = [
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.ts",
] as const;
const angularWorkspaceFileNames = ["angular.json", ".angular.json"] as const;
const gradleSettingsFileNames = ["settings.gradle", "settings.gradle.kts"] as const;
const gradleBuildFileNames = ["build.gradle", "build.gradle.kts"] as const;

async function loadExistingRootFiles(
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

function storybookDependencyVersionSpec(packageJson: Record<string, unknown>): string | undefined {
  const preferredNames = [
    "storybook",
    "@storybook/react",
    "@storybook/vue",
    "@storybook/vue3",
    "@storybook/angular",
    "@storybook/svelte",
    "@storybook/html",
    "@storybook/web-components",
    "@storybook/preact",
    "@storybook/ember",
  ];

  for (const dependencyName of preferredNames) {
    const versionSpec = packageJsonDependencyVersionSpec(packageJson, dependencyName);
    if (versionSpec) {
      return versionSpec;
    }
  }

  for (const section of dependencySectionsOf(packageJson)) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const [dependencyName, versionSpec] of Object.entries(section)) {
      if (
        dependencyName.startsWith("@storybook/") &&
        typeof versionSpec === "string" &&
        versionSpec.trim().length > 0
      ) {
        return versionSpec;
      }
    }
  }

  return undefined;
}

function extractGemVersion(text: string, gemName: string): string | undefined {
  const escaped = gemName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`gem\\s+["']${escaped}["']\\s*,\\s*["']([^"']+)["']`);
  const m = text.match(pattern);
  return m?.[1];
}

function extractRubyVersionFromGemfile(text: string): string | undefined {
  const m = text.match(/ruby\s+["']([^"']+)["']/);
  return m?.[1];
}

export async function collectFrameworkSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["frameworks"]> {
  let usesNextjs = false;
  let nextjsVersionSpec: string | undefined;
  let usesStorybook = false;
  let storybookVersionSpec: string | undefined;
  let usesVite = false;
  let usesAstro = false;
  let usesSvelteKit = false;
  let usesSolidStart = false;
  let usesTurbo = false;
  let usesNx = false;
  let usesLerna = false;
  let usesGradle = false;
  let gradleBuildCacheConfigured = false;
  let usesAngularCli = false;
  let angularCliCacheEnabledForCi = false;
  let usesRails = false;
  let railsVersionSpec: string | undefined;
  let rubyVersionSpec: string | undefined;

  const packageJsonEntry = await context.loadPackageJson();
  const rootEntries = new Set(
    (await context.readDirectoryEntries(context.repoRoot)).map((entry) => entry.name),
  );
  const rootHasEntry = (fileName: string): boolean => rootEntries.has(fileName);
  if (packageJsonEntry.text && packageJsonEntry.value) {
    const packageJsonText = packageJsonEntry.text;
    const packageJson = packageJsonEntry.value;
    nextjsVersionSpec = packageJsonDependencyVersionSpec(packageJson, "next");
    storybookVersionSpec = storybookDependencyVersionSpec(packageJson);
    usesNextjs ||= packageJsonHasDependency(packageJson, "next");
    usesStorybook ||= Boolean(storybookVersionSpec);
    usesVite ||= packageJsonHasDependency(packageJson, "vite");
    usesAstro ||= packageJsonHasDependency(packageJson, "astro");
    usesSvelteKit ||= packageJsonHasDependency(packageJson, "@sveltejs/kit");
    usesSolidStart ||= packageJsonHasDependency(packageJson, "@solidjs/start");
    usesTurbo ||= packageJsonHasDependency(packageJson, "turbo");
    usesNx ||= packageJsonHasDependency(packageJson, "nx");
    usesLerna ||= packageJsonHasDependency(packageJson, "lerna");
    usesAngularCli ||= packageJsonHasDependency(packageJson, "@angular/cli");
    usesNextjs ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bnext\b/i.test(packageJsonText);
    usesStorybook ||=
      /@storybook\/|["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\b(?:build-)?storybook\b/i.test(
        packageJsonText,
      );
    usesVite ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bvite\b/i.test(packageJsonText);
    usesAstro ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bastro\b/i.test(packageJsonText);
    usesSvelteKit ||= /@sveltejs\/kit|["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bsvelte-kit\b/i.test(
      packageJsonText,
    );
    usesSolidStart ||= /@solidjs\/start/i.test(packageJsonText);
    usesTurbo ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bturbo\b/i.test(packageJsonText);
    usesNx ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bnx\b/i.test(packageJsonText);
    usesLerna ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\blerna\b/i.test(packageJsonText);
    usesAngularCli ||= packageJsonText.includes("@angular/cli");
  }

  for (const fileName of nextConfigFileNames) {
    if (rootHasEntry(fileName)) {
      usesNextjs = true;
      break;
    }
  }

  for (const fileName of viteConfigFileNames) {
    if (rootHasEntry(fileName)) {
      usesVite = true;
      break;
    }
  }

  for (const fileName of astroConfigFileNames) {
    if (rootHasEntry(fileName)) {
      usesAstro = true;
      break;
    }
  }

  for (const fileName of svelteConfigFileNames) {
    if (rootHasEntry(fileName)) {
      usesSvelteKit = true;
      break;
    }
  }

  usesTurbo ||= rootHasEntry("turbo.json");
  usesNx ||= rootHasEntry("nx.json");
  usesLerna ||= rootHasEntry("lerna.json");
  usesGradle ||= rootHasEntry("gradlew") || rootHasEntry("gradlew.bat");

  const gradleSettingsFiles = await loadExistingRootFiles(context, gradleSettingsFileNames);
  for (const { text: settingsText } of gradleSettingsFiles) {
    usesGradle = true;
    if (/\bbuildCache\b/i.test(settingsText)) {
      gradleBuildCacheConfigured = true;
    }
  }

  for (const fileName of gradleBuildFileNames) {
    if (rootHasEntry(fileName)) {
      usesGradle = true;
      break;
    }
  }

  const angularWorkspaceFiles = await loadExistingRootFiles(context, angularWorkspaceFileNames);
  for (const { text: workspaceText } of angularWorkspaceFiles) {
    usesAngularCli = true;
    if (
      /"cache"\s*:\s*\{[\s\S]*?"environment"\s*:\s*"ci"/i.test(workspaceText) ||
      /"cache"\s*:\s*\{[\s\S]*?"environment"\s*:\s*"all"/i.test(workspaceText)
    ) {
      angularCliCacheEnabledForCi = true;
    }
  }

  const gemfilePath = context.resolve("Gemfile");
  if (await context.pathExists(gemfilePath)) {
    const gemfileText = await context.readTextFileOrWarn(gemfilePath);
    if (gemfileText) {
      const railsSpec = extractGemVersion(gemfileText, "rails");
      if (railsSpec) {
        usesRails = true;
        railsVersionSpec = railsSpec;
      }
      rubyVersionSpec = extractRubyVersionFromGemfile(gemfileText);
    }
  }

  if (!rubyVersionSpec) {
    const rubyVersionPath = context.resolve(".ruby-version");
    const rubyVersionText = await context.readTextFileOrWarn(rubyVersionPath);
    if (rubyVersionText) {
      const m = rubyVersionText.match(/(\d+\.\d+(?:\.\d+)?)/);
      if (m) {
        rubyVersionSpec = m[1];
      }
    }
  }

  const parsedNextjsVersion = nextjsVersionSpec
    ? parseSemverLikeVersionSpec(nextjsVersionSpec)
    : {};
  const parsedStorybookVersion = storybookVersionSpec
    ? parseSemverLikeVersionSpec(storybookVersionSpec)
    : {};
  const parsedRailsVersion = railsVersionSpec ? parseSemverLikeVersionSpec(railsVersionSpec) : {};
  const parsedRubyVersion = rubyVersionSpec ? parseSemverLikeVersionSpec(rubyVersionSpec) : {};

  return {
    usesNextjs,
    nextjsVersionSpec,
    nextjsMajor: parsedNextjsVersion.major,
    nextjsMinor: parsedNextjsVersion.minor,
    nextjsPatch: parsedNextjsVersion.patch,
    usesStorybook,
    storybookVersionSpec,
    storybookMajor: parsedStorybookVersion.major,
    storybookMinor: parsedStorybookVersion.minor,
    storybookPatch: parsedStorybookVersion.patch,
    usesVite,
    usesAstro,
    usesSvelteKit,
    usesSolidStart,
    usesTurbo,
    usesNx,
    usesLerna,
    usesGradle,
    gradleBuildCacheConfigured,
    usesAngularCli,
    angularCliCacheEnabledForCi,
    usesRails,
    railsVersionSpec,
    railsMajor: parsedRailsVersion.major,
    railsMinor: parsedRailsVersion.minor,
    railsPatch: parsedRailsVersion.patch,
    rubyVersionSpec,
    rubyMajor: parsedRubyVersion.major,
    rubyMinor: parsedRubyVersion.minor,
  };
}
