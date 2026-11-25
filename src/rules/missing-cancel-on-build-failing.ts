import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  buildkiteScriptDeploymentEvidence,
  type BuildkiteDeploymentEvidence,
} from "./shared/buildkite-script-deployment.ts";

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

/** Branch-filtered steps may be mutually exclusive, and explicit dependencies
 * may serialize segment neighbors. Only unfiltered, dependency-free steps
 * count toward segment concurrency. A runnable parallel step's own shards
 * still run together after its dependencies complete. */
function hasConcurrentWork(
  pipeline: PipelineDocument,
  evidence: ReadonlyMap<PipelineStep, BuildkiteDeploymentEvidence>,
): PipelineStep | undefined {
  let run = 0;
  let safeCandidate: PipelineStep | undefined;
  for (const step of pipeline.steps) {
    if (step.isWait || step.isBlock) {
      run = 0;
      safeCandidate = undefined;
      continue;
    }
    if (step.isTrigger || step.isGroup) {
      continue;
    }
    if (!runnableCommandStep(step)) {
      continue;
    }
    const deploys = evidence.get(step) !== "no-evidence";
    if ((step.parallelism ?? 0) >= 2 && !deploys) {
      return step;
    }
    if (!step.branches && step.dependsOnNode === undefined) {
      run += 1;
      if (!deploys) {
        safeCandidate ??= step;
      }
      if (run >= 2 && safeCandidate) {
        return safeCandidate;
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
  async check(pipeline: PipelineDocument, context: RuleContext): Promise<Diagnostic[]> {
    const evidence = await buildkiteScriptDeploymentEvidence(
      pipeline,
      context.scanContext?.repoRoot ?? context.fileIndex?.repoRoot,
    );
    const concurrentStep = hasConcurrentWork(pipeline, evidence);
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
            "Consider cancel_on_build_failing: true only for non-deployment steps whose results cannot change the verdict once the build is failing. Never apply it to deployment steps: interruption can leave environments partially updated. Teams may deliberately keep test lanes running to collect all failures; retry source failures before canceled siblings.",
          measurementHint:
            "Compare total agent time and failure frequency before and after the change. Only failing builds can save time, between the first hard failure and sibling completion; successful builds do not get faster.",
          aiHandoff: `Review ${pipeline.relativePath}: consider cancel_on_build_failing only for non-deployment work near step "${label}". Never cancel deployments through this advice.`,
          score: 40,
        },
      ),
    ];
  },
};
