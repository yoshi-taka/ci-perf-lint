import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getTriggerFacts } from "./shared/trigger-facts.ts";
import { jobEnabledOnPullRequests } from "./shared/pr-run-scope.ts";
import { isHeavyJob, jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "missing-fail-fast-cancellation",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-fail-fast-cancellation.md",
} satisfies RuleMeta;

const gateJobPattern = /\b(lint|fmt|format|style|check)\b/i;
// Without speed evidence (no small gate timeout), only explicit lint/format
// identities qualify; bare "check" can be a test suite (octos
// bundle-release-check), not a gate.
const strictGateJobPattern = /(^|[-_])(lint|fmt|format|style)([-_]|$)/i;
const cancellationMechanismPattern =
  /gh\s+run\s+cancel|cancel-workflow|cancel_workflow|(?:^|[^a-z])cancel(?:-run)?\b/i;
const failureTriggerPattern = /\bfailure\s*\(\s*\)/;

const GATE_TIMEOUT_LIMIT = 15;
const LONG_LANE_TIMEOUT = 20;

function jobNeeds(job: WorkflowJob): string[] {
  const needs = job.raw.needs;
  if (typeof needs === "string") {
    return [needs];
  }
  return Array.isArray(needs)
    ? needs.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function needsClosureIncludes(
  workflow: WorkflowDocument,
  start: WorkflowJob,
  gateId: string,
): boolean {
  const byId = new Map(workflow.jobs.map((job) => [job.id, job]));
  const visited = new Set<string>();
  const queue = [...jobNeeds(start)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === gateId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    const job = byId.get(current);
    if (job) {
      queue.push(...jobNeeds(job));
    }
  }
  return false;
}

function gateTimeout(job: WorkflowJob): number | undefined {
  const value = job.raw["timeout-minutes"];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function isGateCandidate(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  if (job.usesReusableWorkflow || !gateJobPattern.test(job.id)) {
    return false;
  }
  // Result/aggregation jobs run regardless of failure and are mechanisms,
  // not gates.
  const jobIf = typeof job.raw.if === "string" ? job.raw.if : "";
  if (failureTriggerPattern.test(jobIf) || /\balways\s*\(\s*\)/.test(jobIf)) {
    return false;
  }
  // A gate that waits on heavy work is not early: its failure comes after the
  // expensive lanes have already run.
  const byId = new Map(workflow.jobs.map((candidate) => [candidate.id, candidate]));
  for (const need of jobNeeds(job)) {
    const needed = byId.get(need);
    if (needed && isHeavyJob(needed)) {
      return false;
    }
  }
  return true;
}

function isCancellationMechanism(workflow: WorkflowDocument, gateId: string): boolean {
  return workflow.jobs.some((job) => {
    const jobIf = typeof job.raw.if === "string" ? job.raw.if : "";
    const text = `${jobIf} ${job.steps.map((step) => `${step.if ?? ""} ${step.run ?? ""}`).join(" ")}`;
    if (cancellationMechanismPattern.test(text)) {
      return true;
    }
    // A job triggered on the gate's failure with an explicit need on it is
    // the stop mechanism itself.
    return failureTriggerPattern.test(jobIf) && jobNeeds(job).includes(gateId);
  });
}

function uncancelledHeavyLanes(workflow: WorkflowDocument, gate: WorkflowJob): WorkflowJob[] {
  return workflow.jobs.filter((job) => {
    const jobIf = typeof job.raw.if === "string" ? job.raw.if : "";
    if (job.id === gate.id || jobIsStaticallyDisabled(job) || !isHeavyJob(job)) {
      return false;
    }
    // Lanes that (transitively) need the gate are skipped automatically on
    // its failure, so they never waste capacity.
    if (needsClosureIncludes(workflow, job, gate.id)) {
      return false;
    }
    // Result/guard jobs that react to failure are the mechanism, not the waste.
    if (failureTriggerPattern.test(jobIf) || /\balways\s*\(\s*\)/.test(jobIf)) {
      return false;
    }
    return jobEnabledOnPullRequests(job);
  });
}

export const missingFailFastCancellationRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    const facts = getTriggerFacts(workflow);
    if (!facts.hasPullRequest || !(facts.hasPush && !facts.push.hasTagOnly)) {
      return [];
    }

    const gateHits: { gate: WorkflowJob; lanes: WorkflowJob[] }[] = [];
    for (const gate of workflow.jobs) {
      if (!isGateCandidate(workflow, gate)) {
        continue;
      }
      if (isCancellationMechanism(workflow, gate.id)) {
        continue;
      }

      const lanes = uncancelledHeavyLanes(workflow, gate);
      if (lanes.length < 2) {
        continue;
      }
      // Fire only when the shape declares its own cost: either the gate says
      // it is fast (a small explicit timeout), or a strict lint/format gate
      // runs beside at least two lanes that declare themselves long. Bare
      // "check"-named jobs qualify only with their own small timeout;
      // undeclared classic lint-parallel layouts stay silent.
      const gateIsDeclaredFast = (gateTimeout(gate) ?? Infinity) <= GATE_TIMEOUT_LIMIT;
      if (!gateIsDeclaredFast) {
        if (!strictGateJobPattern.test(gate.id)) {
          continue;
        }
        const declaredLongLanes = lanes.filter((lane) => {
          const timeout = gateTimeout(lane);
          return timeout !== undefined && timeout >= LONG_LANE_TIMEOUT;
        });
        if (declaredLongLanes.length < 2) {
          continue;
        }
      }
      gateHits.push({ gate, lanes });
    }

    if (gateHits.length === 0) {
      return [];
    }

    const anchor = gateHits[0]!.gate;
    const gateNames = gateHits.map((hit) => hit.gate.id).join(", ");
    const laneCount = Math.max(...gateHits.map((hit) => hit.lanes.length));
    const pluralGates = gateHits.length > 1;
    findings.push(
      buildDiagnostic(workflow, meta, anchor.node, {
        message: `Fast gate job${pluralGates ? "s" : ""} ${gateNames} fail${pluralGates ? "" : "s"} without cancelling the heavy lanes that do not depend on ${pluralGates ? "them" : "it"} (up to ${laneCount} lanes).`,
        why: "Once a gate has failed, the run's verdict cannot change, yet lanes that do not need it keep occupying runners until they finish — capacity that other queued pull requests are waiting for. Cancelling preserves the verdict at a fraction of the burn. The tradeoff is real: cancelled lanes lose their partial failure signal, so a team that reads every lane's failures in one pass may prefer to keep them running.",
        suggestion:
          "Consider a small job with a needs-and-failure condition on the early gate that cancels the run on pull_request events, or accept the extra runner cost deliberately when reading all lanes' failures at once matters. Keep branch-protection required checks reporting from the pull_request runs.",
        measurementHint:
          "Compare runner minutes of failed runs and the queue wait of other pull requests before and after adding the cancellation job. Confirm required checks still complete on pull_request runs.",
        aiHandoff: `Review ${workflow.relativePath}: the gate job${pluralGates ? "s" : ""} ${gateNames} can fail while heavy lanes keep running. If capacity matters more than complete failure signal, add a needs-and-failure cancellation job for the gate${pluralGates ? "s" : ""}; otherwise document the deliberate choice.`,
        score: 38,
      }),
    );

    return findings;
  },
};
