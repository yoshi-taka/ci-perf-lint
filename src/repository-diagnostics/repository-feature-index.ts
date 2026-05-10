import type { AnalysisWarning } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { DockerBuildTarget, CollectedDockerfileData } from "./docker-build-targets.ts";

export type EcosystemFeature =
  | "javascript"
  | "docker"
  | "terraform"
  | "python"
  | "datadog"
  | "elixir";

const ECOSYSTEM_FEATURES: Record<EcosystemFeature, string> = {
  javascript: "hasNpmEcosystem",
  docker: "hasDockerBuild",
  terraform: "hasTerraform",
  python: "hasPython",
  datadog: "hasDatadog",
  elixir: "hasElixir",
};

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

  getDockerfileData(
    dockerfilePath: string,
    scanContext: RepositoryScanContext,
  ): Promise<CollectedDockerfileData | undefined>;
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

  for (const ecosystem of Object.keys(ECOSYSTEM_FEATURES)) {
    workflowsByEcosystem.set(ecosystem as EcosystemFeature, []);
  }

  for (const workflow of workflows) {
    const wfFacts = getWorkflowFacts(workflow);
    const blob = wfFacts.loweredStepTextBlob;
    const source = workflow.source;
    const matched = new Set<EcosystemFeature>();
    const tp = wfFacts.toolPresence;

    for (const [ecosystem, tpKey] of Object.entries(ECOSYSTEM_FEATURES)) {
      if (tp.get(tpKey)) {
        matched.add(ecosystem as EcosystemFeature);
        ecosystems.add(ecosystem as EcosystemFeature);
        workflowsByEcosystem.get(ecosystem as EcosystemFeature)!.push(workflow);
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
  const dockerfileDataCache = new Map<string, Promise<CollectedDockerfileData | undefined>>();

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

    async getDockerfileData(
      dockerfilePath: string,
      scanContext: RepositoryScanContext,
    ): Promise<CollectedDockerfileData | undefined> {
      const cached = dockerfileDataCache.get(dockerfilePath);
      if (cached) {
        return cached;
      }

      const dataLoad = (async () => {
        const { collectDockerfileData: fetchDockerfileData } =
          await import("./docker-build-targets.ts");
        return fetchDockerfileData(scanContext, dockerfilePath);
      })();
      dockerfileDataCache.set(dockerfilePath, dataLoad);
      return dataLoad;
    },
  };
}
