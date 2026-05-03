import type { RepositorySignals } from "./repository-signals-types.ts";
import {
  dependencySectionsOf,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
} from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

const babelConfigFileNames = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.cts",
  "babel.config.mts",
  "babel.config.json",
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
] as const;

const knownSafeBabelPresets = new Set([
  "@babel/preset-env",
  "@babel/preset-typescript",
  "@babel/preset-flow",
  "@babel/preset-react",
  "babel-preset-minify",
]);

const knownSafeBabelPlugins = new Set([
  "@babel/plugin-transform-runtime",
  "@babel/plugin-syntax-dynamic-import",
  "@babel/plugin-syntax-import-meta",
  "@babel/plugin-proposal-class-properties",
  "@babel/plugin-proposal-optional-chaining",
  "@babel/plugin-proposal-nullish-coalescing-operator",
  "@babel/plugin-transform-modules-commonjs",
]);

const i18nBabelPluginPatterns = [
  "@lingui/babel-plugin",
  "babel-plugin-formatjs",
  "babel-plugin-i18next-extract",
  "babel-plugin-polyglot",
  "i18next-parser",
];

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

function extractPluginNamesFromConfigText(configText: string): string[] {
  const names = new Set<string>();
  const presetMatches = configText.matchAll(
    /['"`](@[^'"`]+\/babel-preset-[^'"`]+|@babel\/preset-[^'"`]+|babel-preset-[^'"`]+|[^'"`]+)['"`]/g,
  );
  for (const match of presetMatches) {
    const name = match[1]?.trim();
    if (name && (name.includes("preset") || knownSafeBabelPresets.has(name))) {
      names.add(name);
    }
  }
  const pluginMatches = configText.matchAll(
    /['"`](@[^'"`]+\/babel-plugin-[^'"`]+|@babel\/plugin-[^'"`]+|babel-plugin-[^'"`]+|[^'"`]+)['"`]/g,
  );
  for (const match of pluginMatches) {
    const name = match[1]?.trim();
    if (name?.includes("plugin")) {
      names.add(name);
    }
  }
  return [...names];
}

function hasBabelCustomPlugins(pluginNames: string[]): boolean {
  for (const name of pluginNames) {
    const isKnownSafe =
      knownSafeBabelPlugins.has(name) ||
      name.startsWith("@babel/plugin-transform-") ||
      name.startsWith("@babel/plugin-syntax-") ||
      name.startsWith("@babel/plugin-proposal-");
    if (!isKnownSafe && name.includes("plugin")) {
      return true;
    }
  }
  return false;
}

function configTextHasDecorators(configText: string): boolean {
  return (
    /['"`]@babel\/plugin-proposal-decorators['"`]/.test(configText) ||
    /['"`]decorators['"`]\s*[:.,]/.test(configText) ||
    /legacy\s*:\s*true/.test(configText)
  );
}

function configTextHasEmotionPlugin(configText: string): boolean {
  return /['"`]@emotion\/babel-plugin['"`]/.test(configText);
}

function configTextHasStyledComponentsPlugin(configText: string): boolean {
  return /['"`]babel-plugin-styled-components['"`]/.test(configText);
}

function configTextHasRelayPlugin(configText: string): boolean {
  return /['"`]babel-plugin-relay['"`]/.test(configText);
}

function configTextHasI18nPlugin(configText: string): boolean {
  return i18nBabelPluginPatterns.some((pattern) =>
    new RegExp(`['"\`]${pattern}['"\`]`).test(configText),
  );
}

function configTextHasMacros(configText: string): boolean {
  return /['"`]babel-plugin-macros['"`]/.test(configText);
}

export async function collectBabelSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["babel"]> {
  let usesBabel = false;
  let versionSpec: string | undefined;
  let hasConfig = false;
  let configFileName: string | undefined;
  const presetNames = new Set<string>();
  const pluginNames = new Set<string>();
  let hasCustomPlugins = false;
  let hasMacros = false;
  let hasDecorators = false;
  let hasEmotionPlugin = false;
  let hasStyledComponentsPlugin = false;
  let hasRelayPlugin = false;
  let hasI18nPlugin = false;
  let hasCoreJs = false;
  let hasLegacyBrowserTargets = false;

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text && packageJsonEntry.value) {
    const packageJsonText = packageJsonEntry.text;
    const packageJson = packageJsonEntry.value;
    versionSpec = packageJsonDependencyVersionSpec(packageJson, "@babel/core");
    usesBabel ||= Boolean(versionSpec);
    hasCoreJs ||= packageJsonHasDependency(packageJson, "core-js");
    hasMacros ||= packageJsonHasDependency(packageJson, "babel-plugin-macros");
    hasEmotionPlugin ||= packageJsonHasDependency(packageJson, "@emotion/babel-plugin");
    hasStyledComponentsPlugin ||= packageJsonHasDependency(
      packageJson,
      "babel-plugin-styled-components",
    );
    hasRelayPlugin ||= packageJsonHasDependency(packageJson, "babel-plugin-relay");
    hasI18nPlugin ||= i18nBabelPluginPatterns.some((pattern) =>
      packageJsonHasDependency(packageJson, pattern),
    );
    usesBabel ||= /["'`](?:build|compile|transpile)[^"'`]*\b(?:babel|@babel\/cli)\b/i.test(
      packageJsonText,
    );
    hasLegacyBrowserTargets ||= textMentionsLegacyBrowserTargets(packageJsonText);

    for (const section of dependencySectionsOf(packageJson)) {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }
      for (const depName of Object.keys(section)) {
        if (depName.startsWith("@babel/plugin-") && !knownSafeBabelPlugins.has(depName)) {
          pluginNames.add(depName);
        }
        if (depName.startsWith("@babel/preset-") || depName.startsWith("babel-preset-")) {
          presetNames.add(depName);
        }
      }
    }
  }

  const configFiles = await loadExistingTextFiles(context, babelConfigFileNames);
  for (const { fileName, text: configText } of configFiles) {
    hasConfig = true;
    configFileName = fileName;
    usesBabel = true;
    const extractedNames = extractPluginNamesFromConfigText(configText);
    for (const name of extractedNames) {
      if (name.includes("preset")) {
        presetNames.add(name);
      }
      if (name.includes("plugin")) {
        pluginNames.add(name);
      }
    }

    hasCustomPlugins ||= hasBabelCustomPlugins([...pluginNames]);
    hasDecorators ||= configTextHasDecorators(configText);
    hasEmotionPlugin ||= configTextHasEmotionPlugin(configText);
    hasStyledComponentsPlugin ||= configTextHasStyledComponentsPlugin(configText);
    hasRelayPlugin ||= configTextHasRelayPlugin(configText);
    hasI18nPlugin ||= configTextHasI18nPlugin(configText);
    hasMacros ||= configTextHasMacros(configText);
    hasLegacyBrowserTargets ||= textMentionsLegacyBrowserTargets(configText);
  }

  const parsedVersion = versionSpec ? parseSemverLikeVersionSpec(versionSpec) : {};
  hasCustomPlugins ||= hasBabelCustomPlugins([...pluginNames]);

  return {
    usesBabel,
    versionSpec,
    major: parsedVersion.major,
    hasConfig,
    configFileName,
    presetNames: [...presetNames].sort(),
    pluginNames: [...pluginNames].sort(),
    hasCustomPlugins,
    hasMacros,
    hasDecorators,
    hasEmotionPlugin,
    hasStyledComponentsPlugin,
    hasRelayPlugin,
    hasI18nPlugin,
    hasCoreJs,
    hasLegacyBrowserTargets,
  };
}
