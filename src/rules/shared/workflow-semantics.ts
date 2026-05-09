import type { WorkflowDocument } from "../../workflow.ts";

import {
  workflowHasManualOnlyTrigger,
  workflowHasScheduleTrigger,
  workflowHasPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasTagOnlyPushTrigger,
  workflowHasBranchPushTrigger,
  workflowHasTriggerPathFilter,
} from "./workflow-triggers.ts";
import { getWorkflowAnalysis } from "./workflow-analysis.ts";
import { workflowHasConcurrency, isHeavyWorkflow } from "./workflows.ts";
import { jobHasMatrix } from "./workflow-jobs.ts";
import { detectInstallCommand, detectLintTool } from "./tools.ts";

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

  getWorkflowAnalysis(workflow);

  let stepCount = 0;
  let hasMatrixJob = false;
  const installManagers = new Set<string>();
  const lintTools = new Set<string>();
  const jobs: JobMetadata[] = [];

  for (const job of workflow.jobs) {
    stepCount += job.steps.length;
    hasMatrixJob ||= jobHasMatrix(job);

    let hasCheckout = false;
    let hasInstall = false;
    let installManager: string | undefined;
    let hasLint = false;
    let lintTool: string | undefined;
    let hasTest = false;
    let hasBuild = false;
    let hasCache = false;

    for (const step of job.steps) {
      const run = step.run ?? "";
      const name = step.name ?? "";
      const text = `${name} ${run}`.toLowerCase();
      const uses = step.uses?.toLowerCase() ?? "";

      hasCheckout ||= uses.startsWith("actions/checkout@");
      hasCache ||=
        uses.startsWith("actions/cache@") || uses.startsWith("ashleytaylor/cache-action@");

      hasLint ||=
        /\b(eslint|oxlint|prettier|actionlint|shellcheck|ruff|markdownlint|biome|yamllint|stylelint)\b/.test(
          text,
        );
      hasTest ||=
        /\b(test|tests|spec|jest|vitest|pytest|mocha|rspec|cargo test|go test|npm test|pnpm test|bun test)\b/.test(
          text,
        );
      hasBuild ||=
        /\b(npm run build|pnpm build|yarn build|bun run build|vite build|next build|turbo run build|nx build|gradle build|mvn build|cargo build|go build|dotnet build|webpack|rollup|esbuild)\b/.test(
          text,
        );

      if (!installManager) {
        const mgr = detectInstallCommand(step);
        if (mgr) {
          installManager = mgr;
        }
      }
      if (!lintTool) {
        const lt = detectLintTool(step);
        if (lt) {
          lintTool = lt;
        }
      }
    }

    hasInstall = Boolean(installManager);

    if (installManager) {
      installManagers.add(installManager);
    }
    if (lintTool) {
      lintTools.add(lintTool);
    }

    jobs.push({
      id: job.id,
      hasMatrix: jobHasMatrix(job),
      hasCheckout,
      hasInstall,
      installManager,
      hasLint,
      lintTool,
      hasTest,
      hasBuild,
      hasCache,
      hasTimeout: Boolean(job.raw["timeout-minutes"]),
    });
  }

  const semantics: WorkflowSemantics = {
    trigger: {
      hasPush: workflowHasPushTrigger(workflow),
      hasPullRequest: workflowHasPullRequestTrigger(workflow),
      hasSchedule: workflowHasScheduleTrigger(workflow),
      hasManualOnly: workflowHasManualOnlyTrigger(workflow),
      hasTagOnlyPush: workflowHasTagOnlyPushTrigger(workflow),
      hasBranchPush: workflowHasBranchPushTrigger(workflow),
      hasPathFilter: workflowHasTriggerPathFilter(workflow),
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

export function getJobSemantics(
  workflow: WorkflowDocument,
  jobId: string,
): JobMetadata | undefined {
  const semantics = buildWorkflowSemantics(workflow);
  return semantics.jobs.find((j) => j.id === jobId);
}
