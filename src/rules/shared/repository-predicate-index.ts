import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { SetupActionKind } from "./tools-text.ts";
import { getStepFacts, type StepFacts } from "./step-facts.ts";
import {
  getJobFacts,
  type JobFacts,
  getWorkflowFacts,
  type WorkflowFacts,
} from "./workflow-analysis.ts";

export interface ResolvedStep {
  readonly workflow: WorkflowDocument;
  readonly job: WorkflowJob;
  readonly step: WorkflowStep;
}

export interface DockerBuildStep extends ResolvedStep {
  readonly dockerfile: string;
  readonly context: string;
  readonly target?: string;
}

export interface RepositoryPredicateIndex {
  readonly allSteps: readonly ResolvedStep[];
  readonly workflowFacts: ReadonlyMap<WorkflowDocument, WorkflowFacts>;
  readonly jobFacts: ReadonlyMap<WorkflowJob, JobFacts>;
  readonly stepFacts: ReadonlyMap<WorkflowStep, StepFacts>;
  readonly bySetupActionKind: ReadonlyMap<SetupActionKind, readonly ResolvedStep[]>;
  readonly byInstallFamily: ReadonlyMap<string, readonly ResolvedStep[]>;
  readonly byUsesPrefix: ReadonlyMap<string, readonly ResolvedStep[]>;
  readonly byUses: ReadonlyMap<string, readonly ResolvedStep[]>;
  readonly dockerBuildSteps: readonly DockerBuildStep[];
}

const DOCKER_BUILD_ACTIONS = ["docker/build-push-action@", "docker/bake-action@"] as const;

function extractDockerBuildParams(step: WorkflowStep): DockerBuildStep | undefined {
  const uses = step.uses ?? "";
  const isDockerAction = DOCKER_BUILD_ACTIONS.some((a) => uses.toLowerCase().startsWith(a));
  if (!isDockerAction) {
    return undefined;
  }
  const withParams = step.with;
  if (!withParams) {
    return undefined;
  }
  const dockerfile =
    typeof withParams.dockerfile === "string" ? withParams.dockerfile : "Dockerfile";
  const context = typeof withParams.context === "string" ? withParams.context : ".";
  const target = typeof withParams.target === "string" ? withParams.target : undefined;
  return { workflow: undefined!, job: undefined!, step, dockerfile, context, target };
}

export function buildRepositoryPredicateIndex(
  workflows: readonly WorkflowDocument[],
): RepositoryPredicateIndex {
  const allSteps: ResolvedStep[] = [];
  const workflowFacts = new Map<WorkflowDocument, WorkflowFacts>();
  const jobFacts = new Map<WorkflowJob, JobFacts>();
  const stepFacts = new Map<WorkflowStep, StepFacts>();
  const bySetupActionKind = new Map<SetupActionKind, ResolvedStep[]>();
  const byInstallFamily = new Map<string, ResolvedStep[]>();
  const byUsesPrefix = new Map<string, ResolvedStep[]>();
  const byUses = new Map<string, ResolvedStep[]>();
  const dockerBuildSteps: DockerBuildStep[] = [];

  for (const workflow of workflows) {
    const wfFacts = getWorkflowFacts(workflow);
    workflowFacts.set(workflow, wfFacts);

    for (const job of workflow.jobs) {
      const jf = getJobFacts(job);
      jobFacts.set(job, jf);

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

        const dockerParams = extractDockerBuildParams(step);
        if (dockerParams) {
          dockerBuildSteps.push({
            workflow,
            job,
            step,
            dockerfile: dockerParams.dockerfile,
            context: dockerParams.context,
            target: dockerParams.target,
          });
        }
      }
    }
  }

  return {
    allSteps,
    workflowFacts,
    jobFacts,
    stepFacts,
    bySetupActionKind,
    byInstallFamily,
    byUsesPrefix,
    byUses,
    dockerBuildSteps,
  };
}
