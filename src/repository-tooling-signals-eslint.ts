import type { RepositorySignals } from "./repository-signals-types.ts";
import { dependencySectionsOf, packageJsonHasDependency } from "./repository-package-helpers.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";

const eslintConfigFileNames = [
  "eslint.base.js",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.jsonc",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.mjs",
] as const;

const prettierConfigFileNames = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.json5",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  "prettier.config.ts",
  "prettier.config.cts",
  "prettier.config.mts",
] as const;

const supportedOxlintPluginNames = new Set([
  "eslint",
  "typescript",
  "unicorn",
  "react",
  "react-perf",
  "nextjs",
  "import",
  "jsdoc",
  "jsx-a11y",
  "node",
  "promise",
  "jest",
  "vitest",
  "vue",
]);

function normalizeEslintPluginName(rawName: string): string | undefined {
  const value = rawName.trim().toLowerCase();
  if (!value) {
    return undefined;
  }

  if (
    value === "@typescript-eslint" ||
    value === "@typescript-eslint/eslint-plugin" ||
    value === "typescript"
  ) {
    return "typescript";
  }

  if (
    value === "eslint-plugin-react" ||
    value === "eslint-plugin-react-hooks" ||
    value === "eslint-plugin-react-refresh" ||
    value === "react" ||
    value === "react-hooks" ||
    value === "react-refresh"
  ) {
    return "react";
  }

  if (value === "eslint-plugin-react-perf" || value === "react-perf") {
    return "react-perf";
  }

  if (value === "@next/eslint-plugin-next" || value === "next" || value === "nextjs") {
    return "nextjs";
  }

  if (
    value === "eslint-plugin-import" ||
    value === "eslint-plugin-import-x" ||
    value === "import"
  ) {
    return "import";
  }

  if (value === "eslint-plugin-jsdoc" || value === "jsdoc") {
    return "jsdoc";
  }

  if (value === "eslint-plugin-jsx-a11y" || value === "jsx-a11y") {
    return "jsx-a11y";
  }

  if (
    value === "eslint-plugin-n" ||
    value === "eslint-plugin-node" ||
    value === "n" ||
    value === "node"
  ) {
    return "node";
  }

  if (value === "eslint-plugin-promise" || value === "promise") {
    return "promise";
  }

  if (value === "@vitest/eslint-plugin" || value === "eslint-plugin-vitest" || value === "vitest") {
    return "vitest";
  }

  if (value === "eslint-plugin-unicorn" || value === "unicorn") {
    return "unicorn";
  }

  if (value === "eslint-plugin-vue" || value === "vue") {
    return "vue";
  }

  if (value.startsWith("eslint-plugin-")) {
    return value.slice("eslint-plugin-".length);
  }

  if (value.includes("/eslint-plugin")) {
    return value;
  }

  return value;
}

function collectPluginNamesFromPackageJson(
  packageJson: Record<string, unknown>,
  pluginNames: Set<string>,
): void {
  for (const section of dependencySectionsOf(packageJson)) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const dependencyName of Object.keys(section)) {
      const normalized = normalizeEslintPluginName(dependencyName);
      if (
        normalized &&
        (dependencyName.includes("eslint-plugin") ||
          dependencyName === "@typescript-eslint/eslint-plugin")
      ) {
        pluginNames.add(normalized);
      }
    }
  }

  const eslintConfig =
    packageJson.eslintConfig &&
    typeof packageJson.eslintConfig === "object" &&
    !Array.isArray(packageJson.eslintConfig)
      ? (packageJson.eslintConfig as Record<string, unknown>)
      : undefined;
  const plugins = eslintConfig?.plugins;
  if (Array.isArray(plugins)) {
    for (const plugin of plugins) {
      if (typeof plugin !== "string") {
        continue;
      }
      const normalized = normalizeEslintPluginName(plugin);
      if (normalized) {
        pluginNames.add(normalized);
      }
    }
  }

  const rules = eslintConfig?.rules;
  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    for (const ruleName of Object.keys(rules)) {
      const slashIndex = ruleName.indexOf("/");
      if (slashIndex <= 0) {
        continue;
      }
      const normalized = normalizeEslintPluginName(ruleName.slice(0, slashIndex));
      if (normalized) {
        pluginNames.add(normalized);
      }
    }
  }
}

function textMentionsPrettierRecommendedConfig(configText: string): boolean {
  return /plugin:prettier\/recommended|['"`]prettier\/recommended['"`]|['"`]plugin:prettier\/recommended['"`]/i.test(
    configText,
  );
}

function textMentionsPrettierRule(configText: string): boolean {
  return /['"`]prettier\/prettier['"`]\s*:/.test(configText);
}

function textMentionsPrettierPlugin(configText: string): boolean {
  return /eslint-plugin-prettier|['"`]prettier['"`]\s*[:,]/i.test(configText);
}

function textMentionsNoBarrelFilesPlugin(configText: string): boolean {
  return /eslint-plugin-no-barrel-files|['"`]no-barrel-files(?:\/[a-z0-9-]+)?['"`]/i.test(
    configText,
  );
}

function textMentionsBarrelFilesPlugin(configText: string): boolean {
  return /eslint-plugin-barrel-files|['"`]barrel-files(?:\/[a-z0-9-]+)?['"`]/i.test(configText);
}

function textMentionsImportPlugin(configText: string): boolean {
  return /eslint-plugin-import|from\s+['"`]eslint-plugin-import['"`]|require\(\s*['"`]eslint-plugin-import['"`]\s*\)|plugins\s*:\s*\[[^\]]*['"`]import['"`]/i.test(
    configText,
  );
}

function textMentionsImportXPlugin(configText: string): boolean {
  return /eslint-plugin-import-x|from\s+['"`]eslint-plugin-import-x['"`]|require\(\s*['"`]eslint-plugin-import-x['"`]\s*\)|plugins\s*:\s*\[[^\]]*['"`]import-x['"`]|['"`]import-x\/[a-z0-9-]+['"`]/i.test(
    configText,
  );
}

function collectPluginNamesFromConfigText(configText: string, pluginNames: Set<string>): void {
  const packageMatches = configText.matchAll(
    /(@[^/"'\s]+\/eslint-plugin(?:-[^/"'\s]+)?)|(eslint-plugin-[^/"'\s]+)/g,
  );
  for (const match of packageMatches) {
    const rawName = match[0];
    const normalized = normalizeEslintPluginName(rawName);
    if (normalized) {
      pluginNames.add(normalized);
    }
  }

  const pluginRuleMatches = configText.matchAll(
    /["'`]([@a-z0-9-]+(?:\/[a-z0-9-]+)?)\/[a-z0-9-]+["'`]\s*:/gi,
  );
  for (const match of pluginRuleMatches) {
    const normalized = normalizeEslintPluginName(match[1] ?? "");
    if (normalized) {
      pluginNames.add(normalized);
    }
  }
}

function collectPrettierPluginNamesFromText(configText: string, pluginNames: Set<string>): void {
  const pluginPackageMatches = configText.matchAll(
    /(@[^/"'\s]+\/prettier-plugin(?:-[^/"'\s]+)?)|(prettier-plugin-[^/"'\s]+)/g,
  );
  for (const match of pluginPackageMatches) {
    const pluginName = match[0].trim();
    if (pluginName) {
      pluginNames.add(pluginName);
    }
  }
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

export async function collectEslintSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["eslint"]> {
  const pluginNames = new Set<string>();
  let usesEslint = false;
  let usesOxlint = false;
  let hasConfig = false;
  let usesCustomExtensions = false;
  let usesPrettierPlugin = false;
  let usesPrettierRecommendedConfig = false;
  let usesPrettierRule = false;
  let usesImportPlugin = false;
  let usesImportXPlugin = false;
  let usesNoBarrelFilesPlugin = false;
  let usesBarrelFilesPlugin = false;

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text && packageJsonEntry.value) {
    const packageJsonText = packageJsonEntry.text;
    const packageJson = packageJsonEntry.value;
    if (packageJson.eslintConfig) {
      hasConfig = true;
    }
    usesEslint ||= packageJsonHasDependency(packageJson, "eslint");
    usesOxlint ||= packageJsonHasDependency(packageJson, "oxlint");
    collectPluginNamesFromPackageJson(packageJson, pluginNames);
    usesPrettierPlugin ||= packageJsonHasDependency(packageJson, "eslint-plugin-prettier");
    usesPrettierRecommendedConfig ||= textMentionsPrettierRecommendedConfig(packageJsonText);
    usesPrettierRule ||= textMentionsPrettierRule(packageJsonText);
    usesImportPlugin ||= packageJsonHasDependency(packageJson, "eslint-plugin-import");
    usesImportXPlugin ||= packageJsonHasDependency(packageJson, "eslint-plugin-import-x");
    usesNoBarrelFilesPlugin ||= packageJsonHasDependency(
      packageJson,
      "eslint-plugin-no-barrel-files",
    );
    usesBarrelFilesPlugin ||= packageJsonHasDependency(packageJson, "eslint-plugin-barrel-files");
    usesEslint ||= /["'`](?:lint|eslint)[^"'`]*["'`]\s*:\s*["'`][^"'`]*\beslint\b/i.test(
      packageJsonText,
    );
    usesOxlint ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\boxlint\b/i.test(packageJsonText);
    usesNoBarrelFilesPlugin ||= textMentionsNoBarrelFilesPlugin(packageJsonText);
    usesBarrelFilesPlugin ||= textMentionsBarrelFilesPlugin(packageJsonText);
  }

  const configFiles = await loadExistingTextFiles(context, eslintConfigFileNames);
  for (const { text: configText } of configFiles) {
    hasConfig = true;
    usesEslint = true;
    collectPluginNamesFromConfigText(configText, pluginNames);
    usesPrettierPlugin ||= textMentionsPrettierPlugin(configText);
    usesPrettierRecommendedConfig ||= textMentionsPrettierRecommendedConfig(configText);
    usesPrettierRule ||= textMentionsPrettierRule(configText);
    usesImportPlugin ||= textMentionsImportPlugin(configText);
    usesImportXPlugin ||= textMentionsImportXPlugin(configText);
    usesNoBarrelFilesPlugin ||= textMentionsNoBarrelFilesPlugin(configText);
    usesBarrelFilesPlugin ||= textMentionsBarrelFilesPlugin(configText);
    if (
      /(?:rulesdir|rulePaths|eslint-plugin-local-rules|require\s*\(\s*["']\.[^"']+["']|from\s+["']\.[^"']+["'])/i.test(
        configText,
      )
    ) {
      usesCustomExtensions = true;
    }
  }

  const normalizedPluginNames = [...pluginNames].sort();
  const unsupportedPluginNames = normalizedPluginNames.filter(
    (pluginName) => !supportedOxlintPluginNames.has(pluginName),
  );

  return {
    usesEslint,
    usesOxlint,
    hasConfig,
    pluginNames: normalizedPluginNames,
    unsupportedPluginNames,
    usesCustomExtensions,
    usesPrettierPlugin,
    usesPrettierRecommendedConfig,
    usesPrettierRule,
    usesImportPlugin,
    usesImportXPlugin,
    usesNoBarrelFilesPlugin,
    usesBarrelFilesPlugin,
  };
}

export async function collectPrettierSignals(
  context: RepositoryScanContext,
): Promise<RepositorySignals["prettier"]> {
  const pluginNames = new Set<string>();
  let usesPrettier = false;
  let usesOxfmt = false;
  let hasConfig = false;
  let usesPrettierEslint = false;

  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text && packageJsonEntry.value) {
    const packageJsonText = packageJsonEntry.text;
    const packageJson = packageJsonEntry.value;
    for (const section of dependencySectionsOf(packageJson)) {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }

      for (const dependencyName of Object.keys(section)) {
        if (dependencyName === "prettier") {
          usesPrettier = true;
        }
        if (dependencyName === "oxfmt") {
          usesOxfmt = true;
        }
        if (dependencyName.includes("prettier-plugin")) {
          pluginNames.add(dependencyName);
        }
        if (dependencyName === "prettier-eslint") {
          usesPrettierEslint = true;
        }
      }
    }

    if (packageJson.prettier) {
      hasConfig = true;
      usesPrettier = true;
      collectPrettierPluginNamesFromText(JSON.stringify(packageJson.prettier), pluginNames);
    }
    usesPrettierEslint ||= packageJsonText.includes("prettier-eslint");
    usesPrettier ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\bprettier\b/i.test(packageJsonText);
    usesOxfmt ||= /["'`][^"'`]*["'`]\s*:\s*["'`][^"'`]*\boxfmt\b/i.test(packageJsonText);
  }

  const configFiles = await loadExistingTextFiles(context, prettierConfigFileNames);
  for (const { text: configText } of configFiles) {
    hasConfig = true;
    usesPrettier = true;
    collectPrettierPluginNamesFromText(configText, pluginNames);
    usesPrettierEslint ||= configText.includes("prettier-eslint");
  }

  return {
    usesPrettier,
    usesOxfmt,
    hasConfig,
    pluginNames: [...pluginNames].sort(),
    usesPrettierEslint,
  };
}
