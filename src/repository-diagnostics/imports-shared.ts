import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { workflowStepTextMatches } from "../rules/shared/workflow-analysis.ts";
import {
  type EvidenceStrength,
  type GradedEvidence,
  strong,
  medium,
  weak,
} from "../rules/shared/evidence.ts";

function matchAny(
  workflow: WorkflowDocument,
  strength: EvidenceStrength,
  entries: [string, RegExp][],
): GradedEvidence<boolean> {
  const signals: string[] = [];
  for (const [label, pattern] of entries) {
    if (workflowStepTextMatches(workflow, pattern)) {
      signals.push(label);
    }
  }
  if (signals.length > 0) {
    return { value: true, strength, signals };
  }
  return { value: false, strength: "weak", signals: [] };
}

function matchStrong(
  workflow: WorkflowDocument,
  patterns: [string, RegExp][],
): GradedEvidence<boolean> {
  return matchAny(workflow, "strong", patterns);
}

function matchMedium(
  workflow: WorkflowDocument,
  patterns: [string, RegExp][],
): GradedEvidence<boolean> {
  return matchAny(workflow, "medium", patterns);
}

function matchWeak(
  workflow: WorkflowDocument,
  patterns: [string, RegExp][],
): GradedEvidence<boolean> {
  return matchAny(workflow, "weak", patterns);
}

export function workflowLooksJavaScriptHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const strongSignals = matchStrong(workflow, [
    ["actions/setup-node", /actions\/setup-node@/],
    ["oven-sh/setup-bun", /oven-sh\/setup-bun@/],
    ["pnpm/action-setup", /pnpm\/action-setup@/],
    ["volta-cli/action", /volta-cli\/action@/],
  ]);
  if (strongSignals.value) {
    return strongSignals;
  }

  const mediumSignals = matchMedium(workflow, [
    ["npm", /\b(npm|pnpm|yarn|bun)\b/],
    [
      "js-tools",
      /\b(eslint|oxlint|tsc|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/,
    ],
  ]);
  if (mediumSignals.value) {
    return mediumSignals;
  }

  return weak(false);
}

export function workflowLooksDockerBuildHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const strongSignals = matchStrong(workflow, [
    ["docker/build-push-action", /docker\/build-push-action@/],
  ]);
  if (strongSignals.value) {
    return strongSignals;
  }

  const mediumSignals = matchMedium(workflow, [
    ["docker buildx", /\bdocker\s+(?:buildx\s+build|build)\b/],
  ]);
  if (mediumSignals.value) {
    return mediumSignals;
  }

  const weakSignals = matchWeak(workflow, [
    ["docker compose build", /\bdocker\s+compose\b[\s\S]*\bbuild\b/],
  ]);
  if (weakSignals.value) {
    return weakSignals;
  }

  return weak(false);
}

export function workflowLooksDatadogHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const strongSignals = matchStrong(workflow, [
    [
      "datadog/datadog-lambda-extension",
      /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/,
    ],
  ]);
  if (strongSignals.value) {
    return strongSignals;
  }
  return weak(false);
}

export function workflowLooksTerraformHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const mediumSignals = matchMedium(workflow, [["terraform init", /\bterraform\s+init\b/]]);
  if (mediumSignals.value) {
    return mediumSignals;
  }
  return weak(false);
}

export function workflowLooksPythonHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const strongSignals = matchStrong(workflow, [["actions/setup-python", /actions\/setup-python@/]]);
  if (strongSignals.value) {
    return strongSignals;
  }

  const mediumSignals = matchMedium(workflow, [
    ["pip install", /\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/],
  ]);
  if (mediumSignals.value) {
    return mediumSignals;
  }

  return weak(false);
}

export function workflowLooksElixirHeavy(workflow: WorkflowDocument): GradedEvidence<boolean> {
  const strongSignals = matchStrong(workflow, [["erlef/setup-beam", /erlef\/setup-beam@/]]);
  if (strongSignals.value) {
    return strongSignals;
  }

  const mediumSignals = matchMedium(workflow, [["elixir/mix", /\belixir\b|\bmix\b/]]);
  if (mediumSignals.value) {
    return mediumSignals;
  }

  const weakSignals = matchWeak(workflow, [["container: elixir", /container:\s*elixir:/]]);
  if (weakSignals.value) {
    return weakSignals;
  }

  return weak(false);
}

export async function looksLikeJavaScriptRepository(
  scanContext: RepositoryScanContext,
): Promise<GradedEvidence<boolean>> {
  const rootEntries = await scanContext.readDirectoryEntries(scanContext.repoRoot);
  const rootNames = new Set(rootEntries.map((entry) => entry.name));
  if (rootNames.has("package.json")) {
    return strong(true, "package.json at root");
  }
  if (rootNames.has("tsconfig.json")) {
    return strong(true, "tsconfig.json at root");
  }
  if (rootNames.has("jsconfig.json")) {
    return strong(true, "jsconfig.json at root");
  }

  for (const name of ["vercel.json", "wrangler.toml", "amplify.yml", "amplify.yaml"] as const) {
    if (rootNames.has(name)) {
      return medium(true, `${name} at root`);
    }
  }

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const subEntries = await scanContext.readDirectoryEntries(scanContext.resolve(entry.name));
    const subNames = new Set(subEntries.map((e) => e.name));
    if (subNames.has("package.json")) {
      return medium(true, `package.json in ${entry.name}/`);
    }
    if (subNames.has("tsconfig.json")) {
      return medium(true, `tsconfig.json in ${entry.name}/`);
    }
    if (subNames.has("jsconfig.json")) {
      return medium(true, `jsconfig.json in ${entry.name}/`);
    }
  }

  return weak(false);
}

export async function looksLikeJavaScriptFrameworksRepository(
  scanContext: RepositoryScanContext,
): Promise<GradedEvidence<boolean>> {
  const packageJsonEntry = await scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson) {
    return weak(false);
  }

  if (packageJsonHasDependency(packageJson, "next")) {
    return strong(true, "next");
  }
  if (packageJsonHasDependency(packageJson, "tailwindcss")) {
    return strong(true, "tailwindcss");
  }
  if (packageJsonHasDependency(packageJson, "jest")) {
    return medium(true, "jest");
  }

  for (const pkg of [
    "@storybook/react",
    "@storybook/vue",
    "@storybook/angular",
    "@storybook/svelte",
    "@storybook/html",
    "@storybook/web-components",
  ] as const) {
    if (packageJsonHasDependency(packageJson, pkg)) {
      return medium(true, pkg);
    }
  }

  return weak(false);
}

export async function looksLikeRustRepository(
  scanContext: RepositoryScanContext,
): Promise<GradedEvidence<boolean>> {
  const exists = await scanContext.pathExists(scanContext.resolve("Cargo.toml"));
  return exists ? strong(true, "Cargo.toml") : weak(false);
}

export function isAllowedSvgComponentImporterPath(relativePath: string): boolean {
  const pathSegments = relativePath.replace(/\\/g, "/").split("/");
  return pathSegments.includes("icons") || pathSegments.includes("icon-components");
}

export async function repositoryUsesMui(scanContext: RepositoryScanContext): Promise<boolean> {
  const packageJsonEntry = await scanContext.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson) {
    return false;
  }

  return (
    packageJsonHasDependency(packageJson, "@mui/material") ||
    packageJsonHasDependency(packageJson, "@mui/icons-material") ||
    packageJsonHasDependency(packageJson, "@mui/system")
  );
}

export function nextjsHasAutomaticMuiImportOptimization(repository: RepositorySignals): boolean {
  const { nextjsMajor, nextjsMinor } = repository.frameworks;
  return (
    typeof nextjsMajor === "number" &&
    typeof nextjsMinor === "number" &&
    (nextjsMajor > 13 || (nextjsMajor === 13 && nextjsMinor >= 5))
  );
}

export function repositoryUsesViteFamily(repository: RepositorySignals): boolean {
  const { usesVite, usesAstro, usesSvelteKit, usesSolidStart } = repository.frameworks;
  return usesVite || usesAstro || usesSvelteKit || usesSolidStart;
}

const largeFileSuffixes = [
  ".csv",
  ".tsv",
  ".jsonl",
  ".ndjson",
  ".parquet",
  ".pdf",
  ".zip",
  ".tar",
  ".tgz",
  ".tar.gz",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".exe",
  ".dmg",
  ".pkg",
  ".msi",
  ".war",
  ".ear",
  ".bin",
  ".dat",
  ".dump",
];

const largeFileIgnoredDirs: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

const pytestConfigFileNames = ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini"] as const;

export async function repositoryLooksPytestHeavy(
  scanContext: RepositoryScanContext,
  workflows: WorkflowDocument[],
): Promise<GradedEvidence<boolean>> {
  for (const fileName of pytestConfigFileNames) {
    if (await scanContext.pathExists(scanContext.resolve(fileName))) {
      return strong(true, `${fileName} at root`);
    }
  }

  for (const workflow of workflows) {
    if (workflowStepTextMatches(workflow, /\bpytest\b/)) {
      return medium(true, "pytest in workflow");
    }
  }

  return weak(false);
}

export async function repositoryLooksLargeFilesHeavy(
  scanContext: RepositoryScanContext,
): Promise<GradedEvidence<boolean>> {
  for await (const _relativePath of scanContext.walkFilesIter(".", {
    ignoredDirectories: largeFileIgnoredDirs,
    include: (relativePath: string) => {
      const lower = relativePath.toLowerCase();
      return largeFileSuffixes.some((suffix) => lower.endsWith(suffix));
    },
  })) {
    return strong(true, "large file suffix found");
  }

  return weak(false);
}
