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
import { buildScheduleSpectrum, estimateCronInterval } from "./shared/schedule-harmonics.ts";

const RESONANCE_EVENTS_THRESHOLD = 3;
const MINUTE_INTERVAL_THRESHOLD = 180;

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
  return estimateCronInterval(cron);
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

    const crons = getWorkflowScheduleCrons(workflow);
    const spectrum = buildScheduleSpectrum(crons);
    const hasFastInterval = spectrum.minInterval < MINUTE_INTERVAL_THRESHOLD;
    const hasResonance = spectrum.resonanceEventsPerDay >= RESONANCE_EVENTS_THRESHOLD;

    if (!hasFastInterval && !hasResonance) {
      return [];
    }

    const name = workflow.name ?? workflow.relativePath;
    const nightly = workflowLooksNightlyLike(workflow);

    const resonanceDetail = hasResonance
      ? ` ${spectrum.resonanceEventsPerDay.toFixed(1)} overlapping triggers per day across ${spectrum.components.length} schedules.`
      : "";

    return [
      pipe(withRepositoryThrottledSchedulePrecedent(_context, workflow.relativePath))(
        buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.root, {
          message: hasFastInterval
            ? `Heavy scheduled workflow "${name}" runs more often than every 3 hours.`
            : `Heavy scheduled workflow "${name}" has harmonic schedule overlap${resonanceDetail}`,
          why: nightly
            ? `Heavy scheduled release, nightly, or benchmarking paths can consume runners and create noisy churn when they run too frequently without a strong reason.${resonanceDetail}`
            : `Heavy scheduled workflows can create avoidable CI cost and queue pressure when they run very frequently.${resonanceDetail}`,
          suggestion:
            "If this schedule does not need to run this often, reduce the cron frequency or add a visible no-change skip path so repeated scheduled runs do less work.",
          measurementHint:
            "Compare scheduled run count, total runner minutes, and useful output before and after reducing frequency or adding a no-change skip.",
          aiHandoff: `Review ${workflow.relativePath} and confirm whether its current cron frequency is still justified. If not, test a slower schedule or a visible no-change skip path and keep the change only if it reduces CI cost without losing needed coverage.`,
          score: hasResonance ? 40 : 32,
        }),
      ),
    ];
  },
};
