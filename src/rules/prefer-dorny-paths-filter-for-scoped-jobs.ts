import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import type { YAMLMap } from "yaml";
import { getScalarValue } from "../workflow.ts";
import { isHeavyJob } from "./shared/workflow-jobs.ts";
import {
  workflowHasBranchPushTrigger,
  workflowHasPullRequestTrigger,
  workflowHasTagOnlyPushTrigger,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

const meta = {
  id: "prefer-dorny-paths-filter-for-scoped-jobs",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-dorny-paths-filter-for-scoped-jobs.md",
} satisfies RuleMeta;

const scopedJobNamePattern =
  /\b(api|backend|frontend|web|mobile|server|client|admin|ios|android|package|packages|service|services|app|apps)\b/i;

function jobLabel(job: WorkflowJob): string {
  const name = isYamlMap(job.node) ? getScalarValue(job.node, "name") : job.raw.name;
  return typeof name === "string" ? `${job.id} ${name}` : job.id;
}

function jobAlreadyUsesChangeOutputGate(job: WorkflowJob): boolean {
  const ifValue = isYamlMap(job.node) ? getScalarValue(job.node, "if") : job.raw.if;
  return typeof ifValue === "string" && /\b(?:needs|steps)\.[^.]+\.outputs\./.test(ifValue);
}

function looksComponentScoped(job: WorkflowJob): boolean {
  return scopedJobNamePattern.test(jobLabel(job));
}

export const preferDornyPathsFilterForScopedJobsRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const hasPullRequest = workflowHasPullRequestTrigger(workflow);
    const hasBranchPush = workflowHasBranchPushTrigger(workflow);

    if ((!hasPullRequest && !hasBranchPush) || workflowHasTagOnlyPushTrigger(workflow)) {
      return [];
    }

    const heavyJobs = workflow.jobs.filter(
      (job) => isHeavyJob(job) && !jobAlreadyUsesChangeOutputGate(job),
    );
    if (heavyJobs.length < 2) {
      return [];
    }

    const scopedHeavyJobs = heavyJobs.filter((job) => looksComponentScoped(job));
    const enoughRepoContext = context.repository.hasMonorepoMarkers || scopedHeavyJobs.length >= 2;

    if (!enoughRepoContext) {
      return [];
    }

    const representativeJobs = (scopedHeavyJobs.length > 0 ? scopedHeavyJobs : heavyJobs)
      .slice(0, 3)
      .map((job) => `"${job.id}"`)
      .join(", ");

    const findings: Diagnostic[] = [
      buildDiagnostic(workflow, meta, workflow.jobsNode ?? workflow.onNode, {
        message: `Workflow has multiple heavy scoped jobs (${representativeJobs}) but no dorny/paths-filter change gate is visible.`,
        why: "Trigger-level paths filters can skip an entire workflow, but they cannot decide which individual component jobs should run after the workflow starts.",
        suggestion:
          "Add a lightweight changes job using dorny/paths-filter@v3, expose outputs for each component, and guard the matching heavy jobs with needs.<changes-job>.outputs.*.",
        measurementHint:
          "Open PRs that touch only one component and compare skipped job count and total billed runner minutes before and after the change gate.",
        aiHandoff: `Review ${workflow.relativePath} and consider adding dorny/paths-filter@v3 to gate component-specific heavy jobs without changing required-check semantics.`,
        score: 66,
      }),
    ];

    return findings;
  },
};
