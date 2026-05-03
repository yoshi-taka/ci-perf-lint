import { readdir } from "node:fs/promises";
import path from "node:path";
import type { RepositorySignals } from "./repository-signals-types.ts";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import type { WorkflowDocument } from "./workflow.ts";

async function countCompositeActions(context: RepositoryScanContext): Promise<number> {
  const repoRoot = context.repoRoot;
  const actionsDir = path.join(repoRoot, ".github", "actions");
  const entries = await readdir(actionsDir, { withFileTypes: true }).catch(() => []);
  let compositeActionCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const actionDir = path.join(actionsDir, entry.name);
    if (
      (await context.pathExists(path.join(actionDir, "action.yml"))) ||
      (await context.pathExists(path.join(actionDir, "action.yaml")))
    ) {
      compositeActionCount += 1;
    }
  }

  return compositeActionCount;
}

const monorepoMarkerNames = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "rush.json",
  "packages",
  "apps",
  "services",
] as const;

const dockerBakeFileNames = [
  "docker-bake.hcl",
  "docker-bake.json",
  "docker-bake.override.hcl",
] as const;

async function hasMonorepoMarkers(context: RepositoryScanContext): Promise<boolean> {
  const repoRoot = context.repoRoot;
  for (const marker of monorepoMarkerNames) {
    if (await context.pathExists(path.join(repoRoot, marker))) {
      return true;
    }
  }

  return false;
}

async function hasDockerBakeFile(context: RepositoryScanContext): Promise<boolean> {
  const repoRoot = context.repoRoot;
  for (const fileName of dockerBakeFileNames) {
    if (await context.pathExists(path.join(repoRoot, fileName))) {
      return true;
    }
  }

  return false;
}

const npmEnvMatcher =
  /\b(?:npm_(?:package|lifecycle|config)_[A-Za-z0-9_]*|NPM_CONFIG_[A-Za-z0-9_]+|NODE_AUTH_TOKEN)\b/i;
const npmrcRelevantSettingMatcher = /^(?:node-options|registry|\/\/|@[^:]+:registry)=/;
const npmrcIgnoredDirs = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

function collectNpmrcRelevantSettings(content: string): string[] {
  const settings = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && npmrcRelevantSettingMatcher.test(trimmed)) {
      const key = trimmed.split("=")[0];
      if (key) {
        settings.add(key);
      }
    }
  }
  return [...settings].sort((left, right) => left.localeCompare(right));
}

function collectScriptLifecycleHooks(packageJson: Record<string, unknown> | undefined): string[] {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }

  const scriptNames = new Set(Object.keys(scripts));
  return [...scriptNames]
    .filter((scriptName) => {
      const match = scriptName.match(/^(pre|post)(.+)$/);
      return Boolean(match?.[2] && scriptNames.has(match[2]));
    })
    .sort((left, right) => left.localeCompare(right));
}

function collectPackageScriptEnvReferences(
  packageJson: Record<string, unknown> | undefined,
): string[] {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }

  return Object.entries(scripts)
    .filter(([, command]) => typeof command === "string" && npmEnvMatcher.test(command))
    .map(([scriptName]) => scriptName)
    .sort((left, right) => left.localeCompare(right));
}

async function collectNpmSignals(
  context: RepositoryScanContext,
  workflows: WorkflowDocument[],
): Promise<RepositorySignals["npm"]> {
  const packageJson = await context.loadPackageJson();
  const npmrcFiles = await context.walkFiles(".", {
    cacheKey: "npmrc-files",
    ignoredDirectories: npmrcIgnoredDirs,
    include: (relativePath) => path.basename(relativePath) === ".npmrc",
  });

  const npmrcRelevantSettingSet = new Set<string>();
  const npmrcContents = await Promise.all(
    npmrcFiles.map(async (npmrcFile) => ({
      npmrcFile,
      content: await context.readTextFileOrWarn(path.join(context.repoRoot, npmrcFile)),
    })),
  );

  for (const { content } of npmrcContents) {
    if (!content) {
      continue;
    }

    for (const setting of collectNpmrcRelevantSettings(content)) {
      npmrcRelevantSettingSet.add(setting);
    }
  }

  const uniqueSettings = [...npmrcRelevantSettingSet].sort((left, right) =>
    left.localeCompare(right),
  );

  const workflowEnvReferences = workflows
    .filter((workflow) => workflow.source !== undefined && npmEnvMatcher.test(workflow.source))
    .map((workflow) => workflow.relativePath)
    .sort((left, right) => left.localeCompare(right));

  return {
    npmrcFiles,
    npmrcRelevantSettings: uniqueSettings,
    lifecycleHookScripts: collectScriptLifecycleHooks(packageJson.value),
    packageScriptEnvReferences: collectPackageScriptEnvReferences(packageJson.value),
    workflowEnvReferences,
  };
}

async function collectStackedDiffSignals(
  context: RepositoryScanContext,
  workflows: WorkflowDocument[],
): Promise<RepositorySignals["stackedDiffs"]> {
  const evidence: string[] = [];
  let graphiteDetected = false;
  let githubStackDetected = false;
  let ghstackDetected = false;
  let genericStackEvidenceCount = 0;

  const pushEvidence = (value: string): void => {
    if (evidence.length < 5) {
      evidence.push(value);
    }
  };

  if (await context.pathExists(context.resolve(".graphite"))) {
    pushEvidence(".graphite directory is present");
    graphiteDetected = true;
  }

  const packageJson = await context.loadPackageJson();
  const packageText = packageJson.text ?? "";
  if (!graphiteDetected && /(?:@withgraphite|graphite-cli|["']gt["'])/i.test(packageText)) {
    pushEvidence("package.json mentions Graphite tooling");
    graphiteDetected = true;
  }
  if (/github\/gh-stack|\bgh\s+stack\b/i.test(packageText)) {
    pushEvidence("package.json mentions GitHub gh-stack tooling");
    githubStackDetected = true;
  }
  if (/\bghstack\b|\.ghstackrc/i.test(packageText)) {
    pushEvidence("package.json mentions ghstack tooling");
    ghstackDetected = true;
  }

  for (const workflow of workflows) {
    if (
      graphiteDetected &&
      githubStackDetected &&
      ghstackDetected &&
      genericStackEvidenceCount >= 2
    ) {
      break;
    }

    const source = workflow.source;
    if (source === undefined) {
      continue;
    }
    if (!graphiteDetected && /withgraphite\/graphite-ci-action@/i.test(source)) {
      pushEvidence(`${workflow.relativePath} uses withgraphite/graphite-ci-action`);
      graphiteDetected = true;
    }

    if (!graphiteDetected && /graphite-base\/|\*\*\/graphite-base\/\*\*/i.test(source)) {
      pushEvidence(`${workflow.relativePath} references graphite-base branches`);
      graphiteDetected = true;
    }

    if (!graphiteDetected && /\bgt\s+(?:submit|stack|sync|modify|create)\b/i.test(source)) {
      pushEvidence(`${workflow.relativePath} mentions Graphite stack commands`);
      graphiteDetected = true;
    }

    if (
      !githubStackDetected &&
      /github\/gh-stack|\bgh\s+stack\s+(?:init|add|view|submit|sync|rebase|push|link)\b/i.test(
        source,
      )
    ) {
      pushEvidence(`${workflow.relativePath} mentions GitHub gh-stack commands`);
      githubStackDetected = true;
    }

    if (
      !ghstackDetected &&
      /\bghstack(?:\s+(?:land|submit|unlink|checkout|logs))?\b|\.ghstackrc|\bgh\/[^/\s]+\/\d+\/(?:base|head|orig)\b/i.test(
        source,
      )
    ) {
      pushEvidence(`${workflow.relativePath} mentions ghstack workflow`);
      ghstackDetected = true;
    }
  }

  const prTemplateCandidates = [
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "pull_request_template.md",
    "PULL_REQUEST_TEMPLATE.md",
  ] as const;

  const templateLoads = await Promise.all(
    prTemplateCandidates.map(async (relativePath) => {
      const templatePath = context.resolve(relativePath);
      if (!(await context.pathExists(templatePath))) {
        return undefined;
      }

      const templateText = await context.readTextFileOrWarn(templatePath);
      if (!templateText) {
        return undefined;
      }

      return { relativePath, templateText };
    }),
  );

  for (const template of templateLoads) {
    if (!template) {
      continue;
    }

    if (!githubStackDetected && /github\/gh-stack|\bgh\s+stack\b/i.test(template.templateText)) {
      pushEvidence(`${template.relativePath} mentions GitHub gh-stack workflow`);
      githubStackDetected = true;
    } else if (
      !ghstackDetected &&
      /\bghstack\b|\.ghstackrc|\bgh\/[^/\s]+\/\d+\/(?:base|head|orig)\b/i.test(
        template.templateText,
      )
    ) {
      pushEvidence(`${template.relativePath} mentions ghstack workflow`);
      ghstackDetected = true;
    } else if (
      genericStackEvidenceCount < 2 &&
      /\b(?:stacked?\s+(?:diffs?|prs?)|upstack|downstack|Graphite)\b/i.test(template.templateText)
    ) {
      pushEvidence(`${template.relativePath} mentions stacked PR workflow`);
      genericStackEvidenceCount += 1;
    }
  }

  const provider = graphiteDetected
    ? "graphite"
    : githubStackDetected
      ? "github"
      : ghstackDetected
        ? "ghstack"
        : undefined;
  const likelyUsed =
    graphiteDetected || githubStackDetected || ghstackDetected || genericStackEvidenceCount >= 2;

  return {
    likelyUsed,
    provider,
    evidence,
  };
}

export async function collectRepositoryAuxSignals(
  context: RepositoryScanContext,
  workflows: WorkflowDocument[],
): Promise<{
  compositeActionCount: number;
  hasMonorepoMarkers: boolean;
  hasDockerBakeFile: boolean;
  stackedDiffs: RepositorySignals["stackedDiffs"];
  npm: RepositorySignals["npm"];
}> {
  const [compositeActionCount, hasMonorepoMarkersValue, hasDockerBakeFileValue, stackedDiffs, npm] =
    await Promise.all([
      countCompositeActions(context),
      hasMonorepoMarkers(context),
      hasDockerBakeFile(context),
      collectStackedDiffSignals(context, workflows),
      collectNpmSignals(context, workflows),
    ]);

  return {
    compositeActionCount,
    hasMonorepoMarkers: hasMonorepoMarkersValue,
    hasDockerBakeFile: hasDockerBakeFileValue,
    stackedDiffs,
    npm,
  };
}
