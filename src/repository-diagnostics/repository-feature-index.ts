import type { AnalysisWarning } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { DockerBuildTarget } from "./docker-build-targets.ts";

const ECOSYSTEM_PATTERNS: Record<string, RegExp> = {
  javascript:
    /actions\/setup-node@|\boven-sh\/setup-bun@|\bpnpm\/action-setup@|\bvolta-cli\/action@|\b(?:npm|pnpm|yarn|bun)\b|\b(?:eslint|oxlint|tsc|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/,
  docker: /docker\/build-push-action@|\bdocker\s+(?:buildx\s+build|build)\b/,
  terraform: /\bterraform\s+init\b/,
  python: /actions\/setup-python@|\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/,
  datadog: /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/,
  elixir: /erlef\/setup-beam@|\belixir\b|\bmix\b|container:\s*elixir:/,
};

export type EcosystemFeature = keyof typeof ECOSYSTEM_PATTERNS;

export interface DockerBuildPresenceFeature {
  readonly hasActionBasedBuild: boolean;
  readonly hasCliDockerBuild: boolean;
  readonly hasComposeBuild: boolean;
  readonly hasAny: boolean;
}

export interface WorkflowFeatureMap {
  readonly loweredStepTextBlob: string;
  readonly sourceText: string | undefined;
  readonly dockerBuild: DockerBuildPresenceFeature;
  readonly hasTerraformInit: boolean;
  readonly hasSparseCheckout: boolean;
  readonly workflow: WorkflowDocument;
}

export interface RepositoryFeatureIndex {
  readonly ecosystems: ReadonlySet<EcosystemFeature>;
  readonly workflowEcosystems: ReadonlyMap<WorkflowDocument, ReadonlySet<EcosystemFeature>>;
  readonly workflowsByEcosystem: ReadonlyMap<EcosystemFeature, readonly WorkflowDocument[]>;
  readonly workflowFeatures: ReadonlyMap<WorkflowDocument, WorkflowFeatureMap>;

  workflowFeature(workflow: WorkflowDocument): WorkflowFeatureMap | undefined;
  workflowsWithEcosystem(ecosystem: EcosystemFeature): readonly WorkflowDocument[];
  workflowsMatchingSource(pattern: RegExp): readonly WorkflowDocument[];
  workflowsMatchingStepText(pattern: RegExp): readonly WorkflowDocument[];

  getDockerBuildTargets(
    repoRoot: string,
    scanContext: RepositoryScanContext,
    warnings?: AnalysisWarning[],
  ): Promise<DockerBuildTarget[]>;
}

const DOCKER_BUILD_PUSH_ACTION_RE = /docker\/build-push-action@/i;
const DOCKER_CLI_BUILD_RE = /\bdocker\s+(?:buildx\s+build|build)\b/i;
const DOCKER_COMPOSE_BUILD_RE = /\bdocker\s+compose\b[\s\S]*\bbuild\b/i;
const TERRAFORM_INIT_RE = /\bterraform\s+init\b/i;
const SPARSE_CHECKOUT_RE = /sparse-checkout/i;

function computeDockerBuildPresence(blob: string): DockerBuildPresenceFeature {
  const hasActionBasedBuild = DOCKER_BUILD_PUSH_ACTION_RE.test(blob);
  const hasCliDockerBuild = DOCKER_CLI_BUILD_RE.test(blob);
  const hasComposeBuild = DOCKER_COMPOSE_BUILD_RE.test(blob);
  return {
    hasActionBasedBuild,
    hasCliDockerBuild,
    hasComposeBuild,
    hasAny: hasActionBasedBuild || hasCliDockerBuild || hasComposeBuild,
  };
}

export function buildRepositoryFeatureIndex(
  workflows: readonly WorkflowDocument[],
): RepositoryFeatureIndex {
  const ecosystems = new Set<EcosystemFeature>();
  const workflowEcosystems = new Map<WorkflowDocument, Set<EcosystemFeature>>();
  const workflowsByEcosystem = new Map<EcosystemFeature, WorkflowDocument[]>();
  const workflowFeatures = new Map<WorkflowDocument, WorkflowFeatureMap>();

  for (const ecosystem of Object.keys(ECOSYSTEM_PATTERNS)) {
    workflowsByEcosystem.set(ecosystem, []);
  }

  for (const workflow of workflows) {
    const wfFacts = getWorkflowFacts(workflow);
    const blob = wfFacts.loweredStepTextBlob;
    const source = workflow.source;
    const matched = new Set<EcosystemFeature>();

    for (const ecosystem of Object.keys(ECOSYSTEM_PATTERNS)) {
      if (ECOSYSTEM_PATTERNS[ecosystem]!.test(blob)) {
        matched.add(ecosystem);
        ecosystems.add(ecosystem);
        workflowsByEcosystem.get(ecosystem)!.push(workflow);
      }
    }

    workflowEcosystems.set(workflow, matched);

    workflowFeatures.set(workflow, {
      workflow,
      loweredStepTextBlob: blob,
      sourceText: source,
      dockerBuild: computeDockerBuildPresence(blob),
      hasTerraformInit: TERRAFORM_INIT_RE.test(blob),
      hasSparseCheckout: source ? SPARSE_CHECKOUT_RE.test(source) : false,
    });
  }

  const workflowsMatchingSourceCache = new Map<string, readonly WorkflowDocument[]>();
  const workflowsMatchingStepTextCache = new Map<string, readonly WorkflowDocument[]>();

  function workflowsMatchingSource(pattern: RegExp): readonly WorkflowDocument[] {
    const key = pattern.source;
    const cached = workflowsMatchingSourceCache.get(key);
    if (cached) {
      return cached;
    }

    const result = workflows.filter((w) => {
      const wf = workflowFeatures.get(w);
      return wf?.sourceText ? pattern.test(wf.sourceText) : false;
    });
    workflowsMatchingSourceCache.set(key, result);
    return result;
  }

  function workflowsMatchingStepText(pattern: RegExp): readonly WorkflowDocument[] {
    const key = pattern.source;
    const cached = workflowsMatchingStepTextCache.get(key);
    if (cached) {
      return cached;
    }

    const result = workflows.filter((w) => {
      const wf = workflowFeatures.get(w);
      return wf ? pattern.test(wf.loweredStepTextBlob) : false;
    });
    workflowsMatchingStepTextCache.set(key, result);
    return result;
  }

  let dockerBuildTargetsPromise: Promise<DockerBuildTarget[]> | undefined;

  return {
    ecosystems,
    workflowEcosystems,
    workflowsByEcosystem,
    workflowFeatures,

    workflowFeature(workflow: WorkflowDocument): WorkflowFeatureMap | undefined {
      return workflowFeatures.get(workflow);
    },

    workflowsWithEcosystem(ecosystem: EcosystemFeature): readonly WorkflowDocument[] {
      return workflowsByEcosystem.get(ecosystem) ?? [];
    },

    workflowsMatchingSource,
    workflowsMatchingStepText,

    async getDockerBuildTargets(
      repoRoot: string,
      scanContext: RepositoryScanContext,
      warnings?: AnalysisWarning[],
    ): Promise<DockerBuildTarget[]> {
      dockerBuildTargetsPromise ??= (async () => {
        const { collectDockerBuildTargets } = await import("./docker-build-targets.ts");
        return collectDockerBuildTargets(repoRoot, [...workflows], warnings, scanContext);
      })();
      return dockerBuildTargetsPromise;
    },
  };
}
