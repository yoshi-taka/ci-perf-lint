import type { Diagnostic } from "../../types.ts";
import type { RuleContext } from "../../rule-engine.ts";
import type { DiagnosticTransform } from "./diagnostic-transform.ts";
import {
  type SimilarWorkflowConsensusAdjustment,
  withJobConsensus,
  withWorkflowConsensus,
} from "./similar-workflow-consensus-shared.ts";

export function withSimilarWorkflowConcurrencyConsensus(
  context: RuleContext,
  workflowPath: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withWorkflowConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.concurrency.get(workflowPath),
      adjustment,
      {
        peerText: "Similar workflows already using concurrency include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already use concurrency.${peerText}`,
        aiHandoff:
          "Match the established concurrency pattern already used in similar workflows where it fits this workflow's trigger semantics.",
      },
    );
}

export function withSimilarWorkflowTimeoutConsensus(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withJobConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.timeoutMinutes.get(workflowPath)?.get(jobId),
      adjustment,
      {
        peerText: "Similar jobs already using timeout-minutes include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar heavy jobs already define job-level timeout-minutes.${peerText}`,
        aiHandoff:
          "Align with the timeout pattern already used by similar heavy jobs where that matches the job's runtime expectations.",
      },
    );
}

export function withSimilarWorkflowDependencyCacheConsensus(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withJobConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.dependencyCache.get(workflowPath)?.get(jobId),
      adjustment,
      {
        peerText: "Similar jobs already using dependency cache include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar jobs already use dependency caching.${peerText}`,
        aiHandoff:
          "Prefer the cache strategy already used by similar jobs before introducing a new cache shape.",
      },
    );
}

export function withSimilarWorkflowDeepCheckoutConsensus(
  context: RuleContext,
  workflowPath: string,
  jobId: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withJobConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.deepCheckout.get(workflowPath)?.get(jobId),
      adjustment,
      {
        peerText: "Similar jobs already using shallow checkout include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar jobs already avoid full-history checkout.${peerText}`,
        aiHandoff:
          "Match the repository's existing shallow-checkout pattern unless this job truly needs full git history.",
      },
    );
}

export function withSimilarWorkflowPathsFilterConsensus(
  context: RuleContext,
  workflowPath: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withWorkflowConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.pathsFilter.get(workflowPath),
      adjustment,
      {
        peerText: "Similar workflows already using trigger path filters include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already narrow triggers with paths or paths-ignore.${peerText}`,
        aiHandoff:
          "Prefer the repository's existing trigger-filter style where it fits this workflow.",
      },
    );
}

export function withSimilarWorkflowNonCodeIgnoreConsensus(
  context: RuleContext,
  workflowPath: string,
  adjustment: SimilarWorkflowConsensusAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) =>
    withWorkflowConsensus(
      diagnostic,
      context.repository.similarWorkflows.index.nonCodeIgnore.get(workflowPath),
      adjustment,
      {
        peerText: "Similar workflows already ignoring obvious non-code changes include",
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already ignore obvious non-code changes.${peerText}`,
        aiHandoff:
          "Prefer the repository's existing non-code ignore patterns where they fit this workflow.",
      },
    );
}

export function detectClusterInconsistency<T>(
  components: number[][],
  getValue: (index: number) => T,
  areInconsistent: (a: T, b: T) => boolean,
): number[][] {
  const inconsistent: number[][] = [];

  for (const cluster of components) {
    if (cluster.length < 2) {
      continue;
    }

    const values = cluster.map((i) => getValue(i));
    const first = values[0]!;
    for (let i = 1; i < values.length; i++) {
      const val = values[i];
      if (val !== undefined && areInconsistent(first, val)) {
        inconsistent.push(cluster);
        break;
      }
    }
  }

  return inconsistent;
}
