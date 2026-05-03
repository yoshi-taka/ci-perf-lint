import { packageJsonHasDependency } from "../repository-package-helpers.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { workflowStepTextMatches } from "../rules/shared/workflow-analysis.ts";

export function workflowLooksJavaScriptHeavy(workflow: WorkflowDocument): boolean {
  return (
    workflowStepTextMatches(
      workflow,
      /actions\/setup-node@|oven-sh\/setup-bun@|pnpm\/action-setup@|volta-cli\/action@/,
    ) ||
    workflowStepTextMatches(workflow, /\b(npm|pnpm|yarn|bun)\b/) ||
    workflowStepTextMatches(
      workflow,
      /\b(eslint|oxlint|tsc|tsgo|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/,
    )
  );
}

export function workflowLooksDockerBuildHeavy(workflow: WorkflowDocument): boolean {
  return (
    workflowStepTextMatches(workflow, /docker\/build-push-action@/) ||
    workflowStepTextMatches(workflow, /\bdocker\s+(?:buildx\s+build|build)\b/) ||
    workflowStepTextMatches(workflow, /\bdocker\s+compose\b[\s\S]*\bbuild\b/)
  );
}

export function workflowLooksDatadogHeavy(workflow: WorkflowDocument): boolean {
  return workflowStepTextMatches(
    workflow,
    /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/,
  );
}

export function workflowLooksTerraformHeavy(workflow: WorkflowDocument): boolean {
  return workflowStepTextMatches(workflow, /\bterraform\s+init\b/);
}

export function workflowLooksPythonHeavy(workflow: WorkflowDocument): boolean {
  return (
    workflowStepTextMatches(workflow, /actions\/setup-python@/) ||
    workflowStepTextMatches(
      workflow,
      /\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/,
    )
  );
}

export async function looksLikeJavaScriptRepository(
  context: RepositoryScanContext,
): Promise<boolean> {
  const rootEntries = await context.readDirectoryEntries(context.repoRoot);
  const rootNames = new Set(rootEntries.map((entry) => entry.name));
  if (
    [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "vercel.json",
      "wrangler.toml",
      "amplify.yml",
      "amplify.yaml",
    ].some((name) => rootNames.has(name))
  ) {
    return true;
  }

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const subEntries = await context.readDirectoryEntries(context.resolve(entry.name));
    if (
      subEntries.some(
        (e) =>
          e.name === "package.json" || e.name === "tsconfig.json" || e.name === "jsconfig.json",
      )
    ) {
      return true;
    }
  }

  return false;
}

export async function looksLikeJavaScriptFrameworksRepository(
  context: RepositoryScanContext,
): Promise<boolean> {
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  if (!packageJson) {
    return false;
  }

  return (
    packageJsonHasDependency(packageJson, "next") ||
    packageJsonHasDependency(packageJson, "@storybook/react") ||
    packageJsonHasDependency(packageJson, "@storybook/vue") ||
    packageJsonHasDependency(packageJson, "@storybook/angular") ||
    packageJsonHasDependency(packageJson, "@storybook/svelte") ||
    packageJsonHasDependency(packageJson, "@storybook/html") ||
    packageJsonHasDependency(packageJson, "@storybook/web-components") ||
    packageJsonHasDependency(packageJson, "tailwindcss") ||
    packageJsonHasDependency(packageJson, "jest")
  );
}

export function workflowLooksElixirHeavy(workflow: WorkflowDocument): boolean {
  return (
    workflowStepTextMatches(workflow, /erlef\/setup-beam@/) ||
    workflowStepTextMatches(workflow, /\belixir\b|\bmix\b/) ||
    workflowStepTextMatches(workflow, /container:\s*elixir:/)
  );
}

export async function looksLikeRustRepository(context: RepositoryScanContext): Promise<boolean> {
  return context.pathExists(context.resolve("Cargo.toml"));
}

export function isAllowedSvgComponentImporterPath(relativePath: string): boolean {
  const pathSegments = relativePath.replace(/\\/g, "/").split("/");
  return pathSegments.includes("icons") || pathSegments.includes("icon-components");
}

export async function repositoryUsesMui(context: RepositoryScanContext): Promise<boolean> {
  const packageJsonEntry = await context.loadPackageJson();
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
  context: RepositoryScanContext,
  workflows: WorkflowDocument[],
): Promise<boolean> {
  for (const fileName of pytestConfigFileNames) {
    if (await context.pathExists(context.resolve(fileName))) {
      return true;
    }
  }

  for (const workflow of workflows) {
    if (workflowStepTextMatches(workflow, /\bpytest\b/)) {
      return true;
    }
  }

  return false;
}

export async function repositoryLooksLargeFilesHeavy(
  context: RepositoryScanContext,
): Promise<boolean> {
  for await (const _relativePath of context.walkFilesIter(".", {
    ignoredDirectories: largeFileIgnoredDirs,
    include: (relativePath: string) => {
      const lower = relativePath.toLowerCase();
      return largeFileSuffixes.some((suffix) => lower.endsWith(suffix));
    },
  })) {
    return true;
  }

  return false;
}
