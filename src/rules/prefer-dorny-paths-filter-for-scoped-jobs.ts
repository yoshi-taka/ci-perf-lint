import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import type { YAMLMap } from "../yaml.ts";
import { getScalarValue } from "../workflow.ts";
import { isHeavyJob } from "./shared/workflow-jobs.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobComponentScope } from "./shared/job-component-scope.ts";

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

const meta = {
  id: "prefer-dorny-paths-filter-for-scoped-jobs",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-dorny-paths-filter-for-scoped-jobs.md",
} satisfies RuleMeta;

function jobAlreadyUsesChangeOutputGate(job: WorkflowJob): boolean {
  const ifValue = isYamlMap(job.node) ? getScalarValue(job.node, "if") : job.raw.if;
  return typeof ifValue === "string" && /\b(?:needs|steps)\.[^.]+\.outputs\./.test(ifValue);
}

export const preferDornyPathsFilterForScopedJobsRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const ts = getTriggerSemantics(workflow);

    if ((!ts.hasPullRequest && !ts.hasBranchPush) || ts.hasTagOnlyPush) {
      return [];
    }

    const heavyJobs = workflow.jobs.filter(
      (job) => isHeavyJob(job) && !jobAlreadyUsesChangeOutputGate(job),
    );
    if (heavyJobs.length < 2) {
      return [];
    }

    const scopedHeavyJobs = heavyJobs.flatMap((job) => {
      const scope = jobComponentScope(workflow, job);
      return scope === undefined ? [] : [{ job, scope }];
    });
    if (new Set(scopedHeavyJobs.map(({ scope }) => scope)).size < 2) {
      return [];
    }

    const representativeJobs = scopedHeavyJobs
      .slice(0, 3)
      .map(({ job, scope }) => `"${job.id}" (${scope})`)
      .join(", ");

    const findings: Diagnostic[] = [
      buildDiagnostic(workflow, meta, workflow.jobsNode ?? workflow.onNode, {
        message: `Workflow has heavy jobs in distinct component directories (${representativeJobs}) without visible output-based change gates.`,
        why: "Separate execution directories suggest candidates for per-component change detection, not proof of independent dependencies. Trigger-level paths filters cannot select individual jobs after the workflow starts.",
        suggestion:
          "Consider a lightweight changes job using dorny/paths-filter@v3 or equivalent. Include shared source, lockfiles, tooling and workflow inputs in each component filter; preserve required-check completion before guarding jobs with needs.<changes-job>.outputs.*.",
        measurementHint:
          "Open PRs that touch only one component and compare skipped job count and total billed runner minutes before and after the change gate.",
        aiHandoff: `Review ${workflow.relativePath} component directories and their shared dependencies before considering dorny/paths-filter@v3 or equivalent. Do not infer safe skips from job names or directories alone; preserve required-check semantics.`,
        score: 66,
      }),
    ];

    return findings;
  },
};
