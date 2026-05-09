import type { WorkflowDocument } from "../../workflow.ts";
import { getStepFacts } from "./step-facts.ts";
import { getJobFacts, getWorkflowFacts } from "./workflow-analysis.ts";

export interface RepositoryPrecedentIndex {
  readonly byUsesPrefix: ReadonlyMap<string, readonly WorkflowDocument[]>;
  readonly byInstallFamily: ReadonlyMap<string, readonly WorkflowDocument[]>;
  readonly byJobIdPattern: ReadonlyMap<string, readonly WorkflowDocument[]>;
  readonly usesDocker: ReadonlySet<WorkflowDocument>;
  readonly hasTimeout: ReadonlySet<WorkflowDocument>;
  readonly hasConcurrency: ReadonlySet<WorkflowDocument>;
  readonly hasMatrix: ReadonlySet<WorkflowDocument>;
}

export function buildRepositoryPrecedentIndex(
  workflows: readonly WorkflowDocument[],
): RepositoryPrecedentIndex {
  const byUsesPrefix = new Map<string, WorkflowDocument[]>();
  const byInstallFamily = new Map<string, WorkflowDocument[]>();
  const byJobIdPattern = new Map<string, WorkflowDocument[]>();
  const usesDocker = new Set<WorkflowDocument>();
  const hasTimeout = new Set<WorkflowDocument>();
  const hasConcurrency = new Set<WorkflowDocument>();
  const hasMatrix = new Set<WorkflowDocument>();

  for (const workflow of workflows) {
    if (getWorkflowFacts(workflow).hasConcurrency) {
      hasConcurrency.add(workflow);
    }
    for (const job of workflow.jobs) {
      const jobFacts = getJobFacts(job);
      if (jobFacts.hasTimeout) {
        hasTimeout.add(workflow);
      }
      if (jobFacts.dockerUsage) {
        usesDocker.add(workflow);
      }

      const strategy = job.raw.strategy;
      if (
        strategy &&
        typeof strategy === "object" &&
        !Array.isArray(strategy) &&
        (strategy as Record<string, unknown>).matrix
      ) {
        hasMatrix.add(workflow);
      }

      for (const step of job.steps) {
        const facts = getStepFacts(step);
        const uses = step.uses?.toLowerCase() ?? "";

        const atIndex = uses.indexOf("@");
        const prefix = atIndex > 0 ? uses.slice(0, atIndex) : "";
        if (prefix) {
          let list = byUsesPrefix.get(prefix);
          if (!list) {
            list = [];
            byUsesPrefix.set(prefix, list);
          }
          if (list[list.length - 1] !== workflow) {
            list.push(workflow);
          }
        }

        if (facts.installCommand) {
          let list = byInstallFamily.get(facts.installCommand);
          if (!list) {
            list = [];
            byInstallFamily.set(facts.installCommand, list);
          }
          if (list[list.length - 1] !== workflow) {
            list.push(workflow);
          }
        }
      }
    }

    for (const pattern of extractJobIdPatterns(workflow)) {
      let list = byJobIdPattern.get(pattern);
      if (!list) {
        list = [];
        byJobIdPattern.set(pattern, list);
      }
      list.push(workflow);
    }
  }

  return {
    byUsesPrefix,
    byInstallFamily,
    byJobIdPattern,
    usesDocker,
    hasTimeout,
    hasConcurrency,
    hasMatrix,
  };
}

function extractJobIdPatterns(workflow: WorkflowDocument): string[] {
  const patterns = new Set<string>();
  for (const job of workflow.jobs) {
    const id = job.id.toLowerCase();
    if (/\bbuild\b/.test(id)) {
      patterns.add("build");
    }
    if (/\btest\b/.test(id)) {
      patterns.add("test");
    }
    if (/\blint\b/.test(id)) {
      patterns.add("lint");
    }
    if (/\bdeploy\b/.test(id)) {
      patterns.add("deploy");
    }
    if (/\brelease\b/.test(id)) {
      patterns.add("release");
    }
    if (/\bci\b/.test(id)) {
      patterns.add("ci");
    }
    if (/\bcheck\b/.test(id)) {
      patterns.add("check");
    }
  }
  return [...patterns];
}
