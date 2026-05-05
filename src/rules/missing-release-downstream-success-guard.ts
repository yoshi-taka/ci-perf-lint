import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import type { YAMLMap } from "yaml";
import { getScalarValue, getStringOrArrayValue } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { withRepositoryReleaseDownstreamGuardPrecedent } from "./shared/similar-workflow-consensus.ts";
import { workflowLooksReleaseLike } from "./shared/workflow-jobs.ts";

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

const meta = {
  id: "missing-release-downstream-success-guard",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-release-downstream-success-guard.md",
} satisfies RuleMeta;

function jobHasNeeds(job: WorkflowJob): boolean {
  if (isYamlMap(job.node)) {
    const needs = getStringOrArrayValue(job.node, "needs");
    return (
      (typeof needs === "string" && needs.trim().length > 0) ||
      (Array.isArray(needs) &&
        needs.some((entry) => typeof entry === "string" && entry.trim().length > 0))
    );
  }
  const needs = job.raw.needs;
  return (
    (typeof needs === "string" && needs.trim().length > 0) ||
    (Array.isArray(needs) &&
      needs.some((entry) => typeof entry === "string" && entry.trim().length > 0))
  );
}

function getJobIfText(job: WorkflowJob): string {
  if (isYamlMap(job.node)) {
    const value = getScalarValue(job.node, "if");
    return typeof value === "string" ? value : "";
  }
  return typeof job.raw.if === "string" ? job.raw.if : "";
}

function hasNeedsSuccessGuard(ifText: string): boolean {
  return /needs\.[^.]+\.(?:result|conclusion)\s*==\s*['"]success['"]/.test(ifText);
}

function hasFailureCancelledGuard(ifText: string): boolean {
  return /!failure\(\)\s*&&\s*!cancelled\(\)|!cancelled\(\)\s*&&\s*!failure\(\)/.test(ifText);
}

function hasStatusFunction(ifText: string): boolean {
  return (
    /\b(?:always|failure|cancelled|success)\(\)/.test(ifText) || ifText.includes("!cancelled()")
  );
}

function hasPositiveStatusFunction(ifText: string, name: "failure" | "cancelled"): boolean {
  return new RegExp(`(^|[^!A-Za-z0-9_])${name}\\(\\)`).test(ifText);
}

function isFailureOrCancellationOnlyPath(ifText: string): boolean {
  const hasFailurePath = hasPositiveStatusFunction(ifText, "failure");
  const hasCancelledPath = hasPositiveStatusFunction(ifText, "cancelled");
  return (
    (hasFailurePath || hasCancelledPath) &&
    !/!failure\(\)|!cancelled\(\)|\bsuccess\(\)/.test(ifText) &&
    !hasNeedsSuccessGuard(ifText)
  );
}

function hasOptionalSkipBypass(ifText: string): boolean {
  return (
    /github\.event_name\s*(?:==|!=)\s*['"][^'"]+['"]/.test(ifText) ||
    /needs\.[^.]+\.outputs\.[A-Za-z0-9_-]+/.test(ifText) ||
    /needs\.[^.]+\.(?:result|conclusion)\s*==\s*['"]skipped['"]/.test(ifText)
  );
}

const REPORTING_UPLOAD_JOB_ID =
  /\b(report|upload|notify|cleanup|aggregat|collect|analytics?|metrics?|alerts?|logging?)\b/i;

const REPORTING_ACTIONS = [
  "datadog/",
  "codecov/",
  "coveralls/",
  "aws-actions/configure-aws-credentials",
  "google-github-actions/auth",
  "google-github-actions/upload-cloud-storage",
];

function isReportingOrUploadJob(job: WorkflowJob): boolean {
  if (REPORTING_UPLOAD_JOB_ID.test(job.id)) {
    return true;
  }
  return job.steps.some((step) => {
    const uses = (step.uses ?? "").toLowerCase();
    return REPORTING_ACTIONS.some((p) => uses.startsWith(p));
  });
}

export const missingReleaseDownstreamSuccessGuardRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (!workflowLooksReleaseLike(workflow, job) || !jobHasNeeds(job)) {
        continue;
      }

      const ifText = getJobIfText(job);
      if (!ifText) {
        continue;
      }

      if (isFailureOrCancellationOnlyPath(ifText)) {
        continue;
      }

      if (isReportingOrUploadJob(job)) {
        continue;
      }

      if (hasOptionalSkipBypass(ifText)) {
        continue;
      }

      const hasFailureAndCancellationGuard = hasFailureCancelledGuard(ifText);
      if (hasNeedsSuccessGuard(ifText) && hasFailureAndCancellationGuard) {
        continue;
      }

      findings.push(
        withRepositoryReleaseDownstreamGuardPrecedent(
          buildDiagnostic(workflow, meta, job.ifNode ?? job.idNode ?? job.node, {
            severity:
              hasFailureAndCancellationGuard || !hasStatusFunction(ifText)
                ? "suggestion"
                : undefined,
            message: `Release-like downstream job "${job.id}" depends on upstream jobs without an explicit success guard.`,
            why: hasFailureAndCancellationGuard
              ? "This job already avoids running after upstream failure or cancellation, so the remaining issue is mostly release readability: which upstream jobs must succeed versus which may intentionally be skipped is not explicit in `needs.*.result` terms."
              : "This job already overrides default dependency behavior with a status-based `if:` condition, so release intent is easier to reason about when it also explicitly gates on upstream success and avoids partial follow-up work after failure or cancellation.",
            suggestion: hasFailureAndCancellationGuard
              ? "If this downstream release job has optional skipped upstream paths, leave the broad failure/cancellation guard alone unless you can safely document the intended `needs.*.result` success or skipped cases."
              : "If this downstream release job really needs a status-based `if:`, confirm which upstream jobs must succeed, preserve any intentional skip-allowing branches, and only then add explicit success checks together with `!failure() && !cancelled()`.",
            measurementHint:
              "Simulate an upstream failure or cancellation and confirm the downstream release job is skipped instead of partially running.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and confirm which upstream jobs truly must succeed versus which may be intentionally skipped before tightening its release downstream guard.`,
            score: hasFailureAndCancellationGuard ? 9 : 73,
          }),
          _context,
          workflow.relativePath,
          job.id,
        ),
      );
    }

    return findings;
  },
};
