import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "missing-cancel-on-build-failing",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-cancel-on-build-failing.md",
  scope: "buildkite",
} satisfies RuleMeta;

function runnableCommandStep(step: PipelineStep): boolean {
  return (
    !step.isWait &&
    !step.isBlock &&
    !step.isTrigger &&
    !step.isGroup &&
    step.skip !== true &&
    step.skip !== "true" &&
    [step.command ?? "", ...(step.commands ?? [])].join("\n").trim().length > 0
  );
}

/** Branch-filtered steps may be mutually exclusive with their segment
 * neighbors (verified on real pipelines), so only unfiltered steps count
 * toward segment concurrency. A parallel step's shards run together on
 * every matching branch regardless. */
function hasConcurrentWork(pipeline: PipelineDocument): PipelineStep | undefined {
  let run = 0;
  let first: PipelineStep | undefined;
  for (const step of pipeline.steps) {
    if (step.isWait || step.isBlock) {
      run = 0;
      continue;
    }
    if (step.isTrigger || step.isGroup) {
      continue;
    }
    if ((step.parallelism ?? 0) >= 2) {
      return step;
    }
    if (runnableCommandStep(step) && !step.branches) {
      run += 1;
      first ??= step;
      if (run >= 2) {
        return first;
      }
    }
  }
  return undefined;
}

function pipelineSetsCancelFlag(pipeline: PipelineDocument): boolean {
  return pipeline.steps.some((step) => {
    if (typeof step.node.toJSON !== "function") {
      return false;
    }
    return (step.node.toJSON() as Record<string, unknown>).cancel_on_build_failing !== undefined;
  });
}

export const missingCancelOnBuildFailingRule = {
  meta,
  check(pipeline: PipelineDocument, _context: RuleContext): Diagnostic[] {
    const concurrentStep = hasConcurrentWork(pipeline);
    if (!concurrentStep || pipelineSetsCancelFlag(pipeline)) {
      return [];
    }

    const label = concurrentStep.label ?? concurrentStep.key ?? "unnamed";
    return [
      buildDiagnostic(
        pipeline,
        meta,
        concurrentStep.commandNode ?? concurrentStep.labelNode ?? concurrentStep.node,
        {
          message: `Pipeline runs steps concurrently but no step sets cancel_on_build_failing.`,
          why: "Without the fast-fail attribute, a failing job leaves its concurrent siblings running to natural completion, occupying agents for results that cannot change the verdict.",
          suggestion:
            "Add cancel_on_build_failing: true to the steps whose results cannot change the verdict once the build is failing. Teams that fix all failures in one pass may deliberately keep lanes running; retries of canceled siblings are also subject to the same policy until the source failure is retried, so retry source failures first.",
          measurementHint:
            "Compare total agent time of failing builds before and after adding the attribute. Cancellation saves only the window between the first hard failure and natural completion of the siblings.",
          aiHandoff: `Review ${pipeline.relativePath}: add cancel_on_build_failing to steps that cannot change the verdict, starting near step "${label}".`,
          score: 40,
        },
      ),
    ];
  },
};
