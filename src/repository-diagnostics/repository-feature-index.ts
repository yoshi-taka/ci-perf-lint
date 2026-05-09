import type { WorkflowDocument } from "../workflow.ts";
import { getWorkflowFacts } from "../rules/shared/workflow-analysis.ts";

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

export interface RepositoryFeatureIndex {
  readonly ecosystems: ReadonlySet<EcosystemFeature>;
  readonly workflowEcosystems: ReadonlyMap<WorkflowDocument, ReadonlySet<EcosystemFeature>>;
  readonly workflowsByEcosystem: ReadonlyMap<EcosystemFeature, readonly WorkflowDocument[]>;
}

export function buildRepositoryFeatureIndex(
  workflows: readonly WorkflowDocument[],
): RepositoryFeatureIndex {
  const ecosystems = new Set<EcosystemFeature>();
  const workflowEcosystems = new Map<WorkflowDocument, Set<EcosystemFeature>>();
  const workflowsByEcosystem = new Map<EcosystemFeature, WorkflowDocument[]>();

  for (const ecosystem of Object.keys(ECOSYSTEM_PATTERNS)) {
    workflowsByEcosystem.set(ecosystem, []);
  }

  for (const workflow of workflows) {
    const wfFacts = getWorkflowFacts(workflow);
    const blob = wfFacts.loweredStepTextBlob;
    const matched = new Set<EcosystemFeature>();

    for (const ecosystem of Object.keys(ECOSYSTEM_PATTERNS)) {
      if (ECOSYSTEM_PATTERNS[ecosystem]!.test(blob)) {
        matched.add(ecosystem);
        ecosystems.add(ecosystem);
        workflowsByEcosystem.get(ecosystem)!.push(workflow);
      }
    }

    workflowEcosystems.set(workflow, matched);
  }

  return {
    ecosystems,
    workflowEcosystems,
    workflowsByEcosystem,
  };
}
