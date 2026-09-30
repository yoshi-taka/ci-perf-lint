import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { getLocation } from "../workflow.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { textDeploysCdkWithoutAssetBuildConcurrency } from "../rules/shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-asset-build-concurrency",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-asset-build-concurrency.md",
} satisfies RuleMeta;

const DOCKER_ASSET_PATTERNS = [/\.fromImageAsset\s*\(/g, /new\s+DockerImageAsset\s*\(/g];

const SOURCE_FILE_PATTERN = /\.(?:ts|js|tsx|jsx)$/;

const ignoredDirectories = new Set([".git", "node_modules", "cdk.out", "fixtures", "__fixtures__"]);

function countDockerAssets(text: string): number {
  let count = 0;
  for (const pattern of DOCKER_ASSET_PATTERNS) {
    const matches = text.match(pattern);
    count += matches ? matches.length : 0;
  }
  return count;
}

async function countCdkDockerAssets(context: RepositoryScanContext): Promise<number> {
  const files = await context.walkFiles(".", {
    ignoredDirectories,
    include: (candidatePath: string) =>
      SOURCE_FILE_PATTERN.test(candidatePath) &&
      !/\b(?:fixtures?|__fixtures__)\b/.test(candidatePath),
  });

  let total = 0;
  for (const file of files) {
    const content = await context.readTextFileOrWarn(context.resolve(file));
    if (!content) {
      continue;
    }
    total += countDockerAssets(content);
  }
  return total;
}

function findDeployStepWithoutConcurrency(
  workflows: WorkflowDocument[],
): { workflow: WorkflowDocument; step: WorkflowStep } | undefined {
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (textDeploysCdkWithoutAssetBuildConcurrency(step.run ?? "")) {
          return { workflow, step };
        }
      }
    }
  }
  return undefined;
}

export async function collectCdkAssetBuildConcurrencyDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  const assetCount = await countCdkDockerAssets(context);
  if (assetCount < 2) {
    return [];
  }

  const offender = findDeployStepWithoutConcurrency(workflows);
  if (!offender) {
    return [];
  }

  const location = getLocation(offender.workflow, offender.step.runNode ?? offender.step.node);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: `CI runs cdk deploy for a CDK app with ${assetCount} Docker image asset(s) but does not pass --asset-build-concurrency.`,
      why: "CDK builds Docker image assets serially (build concurrency 1), so a deploy with several images waits for each build in turn. Parallelizing the builds can cut the asset phase substantially; the CDK issue that motivated the flag showed five 10-second images dropping from over 50 seconds to about 10 seconds.",
      suggestion:
        "Add --asset-build-concurrency (for example --asset-build-concurrency 4) to CI cdk deploy commands that build multiple Docker image assets.",
      measurementHint:
        "Compare cdk deploy wall-clock time before and after enabling --asset-build-concurrency, and watch for container registry rate limits or runner resource contention.",
      aiHandoff: `Review ${offender.workflow.relativePath} and add --asset-build-concurrency (for example 4) to the cdk deploy command. The CDK app builds multiple Docker image assets. Note that the flag only applies to Docker-based bundling, not to ILocalBundling assets, and keep unrelated deploy flags unchanged.`,
      score: 34,
    }),
  ];
}
