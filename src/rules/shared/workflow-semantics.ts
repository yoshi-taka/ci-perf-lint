import type { WorkflowDocument } from "../../workflow.ts";

import { getWorkflowFacts, getJobFacts } from "./workflow-analysis.ts";
import { workflowHasConcurrency, isHeavyWorkflow } from "./workflows.ts";
import { jobHasMatrix } from "./workflow-jobs.ts";

export interface JobMetadata {
  id: string;
  hasMatrix: boolean;
  hasCheckout: boolean;
  hasInstall: boolean;
  installManager?: string;
  hasLint: boolean;
  lintTool?: string;
  hasTest: boolean;
  hasBuild: boolean;
  hasCache: boolean;
  hasTimeout: boolean;
}

export interface WorkflowSemantics {
  trigger: {
    hasPush: boolean;
    hasPullRequest: boolean;
    hasSchedule: boolean;
    hasManualOnly: boolean;
    hasTagOnlyPush: boolean;
    hasBranchPush: boolean;
    hasPathFilter: boolean;
  };
  jobCount: number;
  stepCount: number;
  hasConcurrency: boolean;
  isHeavy: boolean;
  jobs: JobMetadata[];
  installManagers: ReadonlySet<string>;
  lintTools: ReadonlySet<string>;
  hasMatrixJob: boolean;
}

const semanticsCache = new WeakMap<WorkflowDocument, WorkflowSemantics>();

export function buildWorkflowSemantics(workflow: WorkflowDocument): WorkflowSemantics {
  const cached = semanticsCache.get(workflow);
  if (cached) {
    return cached;
  }

  const wfFacts = getWorkflowFacts(workflow);
  const tf = wfFacts.triggerFacts;

  let stepCount = 0;
  let hasMatrixJob = false;
  const installManagers = new Set<string>();
  const lintTools = new Set<string>();
  const jobs: JobMetadata[] = [];

  for (const job of workflow.jobs) {
    const jf = getJobFacts(job);
    stepCount += job.steps.length;
    hasMatrixJob ||= jobHasMatrix(job);

    const lintTool = jf.lintTools.size > 0 ? [...jf.lintTools][0] : undefined;

    if (jf.installManager) {
      installManagers.add(jf.installManager);
    }
    if (lintTool) {
      lintTools.add(lintTool);
    }

    jobs.push({
      id: job.id,
      hasMatrix: jobHasMatrix(job),
      hasCheckout: jf.checkoutStep !== undefined,
      hasInstall: jf.hasInstall,
      installManager: jf.installManager,
      hasLint: lintTool !== undefined,
      lintTool,
      hasTest: jf.hasTest,
      hasBuild: jf.hasBuild,
      hasCache: jf.hasCache,
      hasTimeout: jf.hasTimeout,
    });
  }

  const semantics: WorkflowSemantics = {
    trigger: {
      hasPush: tf.hasPush,
      hasPullRequest: tf.hasPullRequest,
      hasSchedule: tf.hasSchedule,
      hasManualOnly: tf.isManualOnly,
      hasTagOnlyPush: tf.push.hasTagOnly,
      hasBranchPush: tf.push.hasBranchPush,
      hasPathFilter: tf.hasTriggerPathFilter,
    },
    jobCount: workflow.jobs.length,
    stepCount,
    hasConcurrency: workflowHasConcurrency(workflow),
    isHeavy: isHeavyWorkflow(workflow),
    jobs,
    installManagers,
    lintTools,
    hasMatrixJob,
  };

  semanticsCache.set(workflow, semantics);
  return semantics;
}
