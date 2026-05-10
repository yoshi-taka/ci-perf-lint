import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import {
  getWorkflowScheduleCrons,
  workflowHasManualOnlyTrigger,
  workflowHasScheduleTrigger,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { pipe } from "./shared/diagnostic-transform.ts";
import { withRepositoryThrottledSchedulePrecedent } from "./shared/similar-workflow-consensus.ts";

const meta = {
  id: "scheduled-heavy-workflow-without-throttling",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/scheduled-heavy-workflow-without-throttling.md",
  requiredFeatures: {
    workflowFacts: {
      isHeavyWorkflow: true,
    },
  },
} satisfies RuleMeta;

export function estimateScheduleMinutes(cron: string): number | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return undefined;
  }

  const minute = parts[0];
  const hour = parts[1];
  if (!minute || !hour) {
    return undefined;
  }

  const minuteEveryMatch = /^\*\/(\d+)$/.exec(minute);
  if (minuteEveryMatch?.[1]) {
    return Number.parseInt(minuteEveryMatch[1], 10);
  }
  if (minute === "*" && hour === "*") {
    return 1;
  }
  if (minute === "*") {
    return 1;
  }
  if (/^\d+$/.test(minute) && hour === "*") {
    return 60;
  }

  const hourEveryMatch = /^\*\/(\d+)$/.exec(hour);
  if (hourEveryMatch?.[1]) {
    return Number.parseInt(hourEveryMatch[1], 10) * 60;
  }
  if (/^\d+(,\d+)+$/.test(hour)) {
    const values = hour
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .sort((a, b) => a - b);
    const first = values[0];
    const second = values[1];
    if (first !== undefined && second !== undefined) {
      return Math.max(1, second - first) * 60;
    }
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    return 24 * 60;
  }

  return undefined;
}

function workflowLooksNightlyLike(workflow: WorkflowDocument): boolean {
  const name = workflow.name?.toLowerCase() ?? "";
  return /\b(nightly|release|publish|e2e|benchmark|perf)\b/.test(name);
}

export const scheduledHeavyWorkflowWithoutThrottlingRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, _context: RuleContext) {
    if (workflowHasManualOnlyTrigger(workflow) || !workflowHasScheduleTrigger(workflow)) {
      return [];
    }

    const minimumInterval = getWorkflowScheduleCrons(workflow)
      .map((cron) => estimateScheduleMinutes(cron))
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];

    if (minimumInterval === undefined || minimumInterval >= 180) {
      return [];
    }

    return [
      pipe(withRepositoryThrottledSchedulePrecedent(_context, workflow.relativePath))(
        buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.root, {
          message: `Heavy scheduled workflow "${workflow.name ?? workflow.relativePath}" runs more often than every 3 hours.`,
          why: workflowLooksNightlyLike(workflow)
            ? "Heavy scheduled release, nightly, or benchmarking paths can consume runners and create noisy churn when they run too frequently without a strong reason."
            : "Heavy scheduled workflows can create avoidable CI cost and queue pressure when they run very frequently.",
          suggestion:
            "If this schedule does not need to run this often, reduce the cron frequency or add a visible no-change skip path so repeated scheduled runs do less work.",
          measurementHint:
            "Compare scheduled run count, total runner minutes, and useful output before and after reducing frequency or adding a no-change skip.",
          aiHandoff: `Review ${workflow.relativePath} and confirm whether its current cron frequency is still justified. If not, test a slower schedule or a visible no-change skip path and keep the change only if it reduces CI cost without losing needed coverage.`,
          score: 32,
        }),
      ),
    ];
  },
};
