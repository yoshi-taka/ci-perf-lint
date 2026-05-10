import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { SetupActionKind } from "./tools-text.ts";
import { getStepFacts, type StepFacts } from "./step-facts.ts";
import {
  getJobFacts,
  type JobFacts,
  getWorkflowFacts,
  type WorkflowFacts,
} from "./workflow-analysis.ts";
import type { AnalysisWarning } from "../../types.ts";
import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import type { DockerBuildTarget } from "../../repository-diagnostics/docker-build-targets.ts";
import type { ResolvedStep } from "./repository-predicate-index.ts";

type EcosystemFeature = "javascript" | "docker" | "terraform" | "python" | "datadog" | "elixir";

const ECOSYSTEM_TOOL_FEATURES: Record<EcosystemFeature, string> = {
  javascript: "hasNpmEcosystem",
  docker: "hasDockerBuild",
  terraform: "hasTerraform",
  python: "hasPython",
  datadog: "hasDatadog",
  elixir: "hasElixir",
};

const COMMAND_KEYWORDS = [
  "pytest",
  "tox",
  "nox",
  "nox",
  "docker",
  "terraform",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "pip",
  "poetry",
  "uv",
  "cargo",
  "go",
  "make",
  "gradle",
  "gradlew",
  "mvn",
  "npx",
  "eslint",
  "oxlint",
  "prettier",
  "oxfmt",
  "jest",
  "vitest",
  "tsc",
  "next",
  "webpack",
  "rspack",
  "rollup",
  "esbuild",
  "vite",
  "turbo",
  "nx",
  "lerna",
  "build",
  "test",
  "lint",
  "deploy",
  "release",
  "publish",
  "check",
  "sparse-checkout",
  "clone",
  "fetch",
] as const;

const KEYWORD_PATTERNS: Record<string, RegExp> = {};
for (const keyword of COMMAND_KEYWORDS) {
  KEYWORD_PATTERNS[keyword] = new RegExp(`\\b${keyword}\\b`, "i");
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const matches = text.toLowerCase().match(/\b[a-z][a-z0-9_-]{2,}\b/g);
  if (matches) {
    for (const m of matches) {
      tokens.push(m);
    }
  }
  return tokens;
}

export interface RepositoryCorpusIndex {
  readonly allSteps: readonly ResolvedStep[];
  readonly workflowFacts: ReadonlyMap<WorkflowDocument, WorkflowFacts>;
  readonly jobFacts: ReadonlyMap<WorkflowJob, JobFacts>;
  readonly stepFacts: ReadonlyMap<WorkflowStep, StepFacts>;
  readonly bySetupActionKind: ReadonlyMap<SetupActionKind, readonly ResolvedStep[]>;
  readonly byInstallFamily: ReadonlyMap<string, readonly ResolvedStep[]>;
  readonly byUsesPrefix: ReadonlyMap<string, readonly ResolvedStep[]>;
  readonly byUses: ReadonlyMap<string, readonly ResolvedStep[]>;

  stepsMatchingText(pattern: RegExp): readonly ResolvedStep[];
  allWorkflowsWithFeature(feature: string): readonly WorkflowDocument[];
  workflowsWithEcosystem(eco: EcosystemFeature): readonly WorkflowDocument[];
  stepKeywordIndex: ReadonlyMap<string, readonly ResolvedStep[]>;
  workflowEcosystems: ReadonlyMap<WorkflowDocument, ReadonlySet<EcosystemFeature>>;

  getDockerBuildTargets(
    repoRoot: string,
    scanContext: RepositoryScanContext,
    warnings?: AnalysisWarning[],
  ): Promise<DockerBuildTarget[]>;
}

export function buildRepositoryCorpusIndex(
  workflows: readonly WorkflowDocument[],
): RepositoryCorpusIndex {
  const allSteps: ResolvedStep[] = [];
  const workflowFacts = new Map<WorkflowDocument, WorkflowFacts>();
  const jobFacts = new Map<WorkflowJob, JobFacts>();
  const stepFacts = new Map<WorkflowStep, StepFacts>();
  const bySetupActionKind = new Map<SetupActionKind, ResolvedStep[]>();
  const byInstallFamily = new Map<string, ResolvedStep[]>();
  const byUsesPrefix = new Map<string, ResolvedStep[]>();
  const byUses = new Map<string, ResolvedStep[]>();

  const stepKeywords = new Map<string, ResolvedStep[]>();
  const workflowsByFeature = new Map<string, WorkflowDocument[]>();
  const workflowEcosystems = new Map<WorkflowDocument, Set<EcosystemFeature>>();

  const workflowsByEcosystem = new Map<EcosystemFeature, WorkflowDocument[]>();

  for (const eco of Object.keys(ECOSYSTEM_TOOL_FEATURES)) {
    workflowsByEcosystem.set(eco as EcosystemFeature, []);
  }

  for (const workflow of workflows) {
    const wf = getWorkflowFacts(workflow);
    workflowFacts.set(workflow, wf);
    const matchedEcosystems = new Set<EcosystemFeature>();

    for (const [eco, tpKey] of Object.entries(ECOSYSTEM_TOOL_FEATURES)) {
      if (wf.toolPresence.get(tpKey)) {
        matchedEcosystems.add(eco as EcosystemFeature);
        workflowsByEcosystem.get(eco as EcosystemFeature)!.push(workflow);
      }
    }
    workflowEcosystems.set(workflow, matchedEcosystems);

    for (const feature of wf.toolPresence.keys()) {
      if (wf.toolPresence.get(feature)) {
        let list = workflowsByFeature.get(feature);
        if (!list) {
          list = [];
          workflowsByFeature.set(feature, list);
        }
        list.push(workflow);
      }
    }

    for (const job of workflow.jobs) {
      jobFacts.set(job, getJobFacts(job));

      for (const step of job.steps) {
        const sf = getStepFacts(step);
        stepFacts.set(step, sf);

        const resolved: ResolvedStep = { workflow, job, step };
        allSteps.push(resolved);

        if (sf.setupActionKind) {
          let list = bySetupActionKind.get(sf.setupActionKind);
          if (!list) {
            list = [];
            bySetupActionKind.set(sf.setupActionKind, list);
          }
          list.push(resolved);
        }

        if (sf.installCommand) {
          let list = byInstallFamily.get(sf.installCommand);
          if (!list) {
            list = [];
            byInstallFamily.set(sf.installCommand, list);
          }
          list.push(resolved);
        }

        const uses = step.uses;
        if (uses) {
          let usesList = byUses.get(uses);
          if (!usesList) {
            usesList = [];
            byUses.set(uses, usesList);
          }
          usesList.push(resolved);

          const atIndex = uses.indexOf("@");
          if (atIndex > 0) {
            const prefix = uses.slice(0, atIndex);
            let prefixList = byUsesPrefix.get(prefix);
            if (!prefixList) {
              prefixList = [];
              byUsesPrefix.set(prefix, prefixList);
            }
            prefixList.push(resolved);
          }
        }

        const tokens = tokenize(sf.loweredStepText);
        const seen = new Set<string>();
        for (const token of tokens) {
          if (seen.has(token)) {
            continue;
          }
          seen.add(token);
          let list = stepKeywords.get(token);
          if (!list) {
            list = [];
            stepKeywords.set(token, list);
          }
          list.push(resolved);
        }
      }
    }
  }

  const frozenKeywords = new Map<string, readonly ResolvedStep[]>();
  for (const [key, list] of stepKeywords) {
    frozenKeywords.set(key, list);
  }

  const stepTextCache = new Map<string, readonly ResolvedStep[]>();

  function stepsMatchingText(pattern: RegExp): readonly ResolvedStep[] {
    const key = pattern.source;
    const cached = stepTextCache.get(key);
    if (cached) {
      return cached;
    }

    const lower = pattern.source.toLowerCase();
    let candidates: readonly ResolvedStep[] | undefined;
    for (const kw of COMMAND_KEYWORDS) {
      if (lower.includes(kw.toLowerCase())) {
        const indexed = frozenKeywords.get(kw);
        if (indexed) {
          candidates = indexed;
        }
        break;
      }
    }

    const pool = candidates ?? allSteps;
    const result = pool.filter((rs) => {
      const sf = stepFacts.get(rs.step);
      return sf ? pattern.test(sf.loweredStepText) : false;
    });

    stepTextCache.set(key, result);
    return result;
  }

  let dockerBuildTargetsPromise: Promise<DockerBuildTarget[]> | undefined;

  return {
    allSteps,
    workflowFacts,
    jobFacts,
    stepFacts,
    bySetupActionKind,
    byInstallFamily,
    byUsesPrefix,
    byUses,

    stepKeywordIndex: frozenKeywords,

    workflowEcosystems,

    stepsMatchingText,
    allWorkflowsWithFeature(feature: string): readonly WorkflowDocument[] {
      return workflowsByFeature.get(feature) ?? [];
    },
    workflowsWithEcosystem(eco: EcosystemFeature): readonly WorkflowDocument[] {
      return workflowsByEcosystem.get(eco) ?? [];
    },

    async getDockerBuildTargets(
      repoRoot: string,
      scanContext: RepositoryScanContext,
      warnings?: AnalysisWarning[],
    ): Promise<DockerBuildTarget[]> {
      dockerBuildTargetsPromise ??= (async () => {
        const { collectDockerBuildTargets } =
          await import("../../repository-diagnostics/docker-build-targets.ts");
        return collectDockerBuildTargets(repoRoot, [...workflows], warnings, scanContext);
      })();
      return dockerBuildTargetsPromise;
    },
  };
}
