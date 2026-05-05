import type { WorkflowDocument } from "./workflow.ts";
import { isHeavyWorkflow, workflowLooksMetaCheckLike } from "./rules/shared/workflow-jobs.ts";
import {
  workflowHasNonCodeIgnore,
  workflowHasTriggerPathFilter,
} from "./rules/shared/workflow-triggers.ts";
import {
  collectPeerIndexes,
  encodeFeatureMasks,
} from "./repository-similar-workflows-similarity.ts";
import {
  collectJobSummaries,
  type JobSummary,
} from "./repository-similar-workflows-job-summaries.ts";
import {
  collectRepositoryPrecedentSignals as collectRepositoryPrecedentSignalsFromPrecedents,
  type RepositoryPrecedentSignals,
} from "./repository-similar-workflows-precedents.ts";
import { collectWorkflowSummary } from "./repository-similar-workflows-workflow-summaries.ts";

export { collectJobSummaries } from "./repository-similar-workflows-job-summaries.ts";
export type { RepositoryPrecedentSignals } from "./repository-similar-workflows-precedents.ts";

const minimumPeerCount = 3;
const minimumConsensusRatio = 0.75;

interface SimilarWorkflowConcurrencyEvidence {
  workflowPath: string;
  peerCount: number;
  peerWorkflowPaths: string[];
}

interface SimilarWorkflowTimeoutEvidence {
  workflowPath: string;
  jobId: string;
  peerCount: number;
  peerJobLabels: string[];
}

interface SimilarWorkflowSignals {
  concurrency: SimilarWorkflowConcurrencyEvidence[];
  timeoutMinutes: SimilarWorkflowTimeoutEvidence[];
  dependencyCache: SimilarWorkflowTimeoutEvidence[];
  deepCheckout: SimilarWorkflowTimeoutEvidence[];
  pathsFilter: SimilarWorkflowConcurrencyEvidence[];
  nonCodeIgnore: SimilarWorkflowConcurrencyEvidence[];
}

function countMatchingPeers<T>(
  peerIndexes: number[],
  summaries: T[],
  predicate: (summary: T) => boolean,
): number {
  let count = 0;

  for (const peerIndex of peerIndexes) {
    const peer = summaries[peerIndex];
    if (peer && predicate(peer)) {
      count += 1;
    }
  }

  return count;
}

function collectPeerLabels<T>(
  peerIndexes: number[],
  summaries: T[],
  predicate: (summary: T) => boolean,
  label: (summary: T) => string,
): string[] {
  const labels: string[] = [];

  for (const peerIndex of peerIndexes) {
    const peer = summaries[peerIndex];
    if (peer && predicate(peer)) {
      labels.push(label(peer));
    }
  }

  return labels.sort((left, right) => left.localeCompare(right)).slice(0, 5);
}

export function collectSimilarWorkflowSignals(
  workflows: WorkflowDocument[],
  sharedJobSummaries?: JobSummary[],
): SimilarWorkflowSignals {
  const workflowSummaries = workflows.map((workflow) => collectWorkflowSummary(workflow));
  const jobSummaries = sharedJobSummaries ?? collectJobSummaries(workflows);
  encodeFeatureMasks(workflowSummaries);
  encodeFeatureMasks(jobSummaries);
  const workflowPeerIndexes = collectPeerIndexes(
    workflowSummaries,
    (left, right) => left.workflow.relativePath === right.workflow.relativePath,
  );
  const jobPeerIndexes = collectPeerIndexes(
    jobSummaries,
    (left, right) =>
      left.workflow.relativePath === right.workflow.relativePath && left.job.id === right.job.id,
  );

  const concurrency: SimilarWorkflowConcurrencyEvidence[] = [];
  const timeoutMinutes: SimilarWorkflowTimeoutEvidence[] = [];
  const dependencyCache: SimilarWorkflowTimeoutEvidence[] = [];
  const deepCheckout: SimilarWorkflowTimeoutEvidence[] = [];
  const pathsFilter: SimilarWorkflowConcurrencyEvidence[] = [];
  const nonCodeIgnore: SimilarWorkflowConcurrencyEvidence[] = [];

  for (const [summaryIndex, summary] of workflowSummaries.entries()) {
    const peers = workflowPeerIndexes[summaryIndex] ?? [];
    if (peers.length < minimumPeerCount) { continue; }

    if (summary.eligibleForConcurrency && !summary.hasConcurrency) {
      const eligibleWithConcurrencyCount = countMatchingPeers(
        peers, workflowSummaries,
        (peer) => peer.eligibleForConcurrency && peer.hasConcurrency,
      );
      const eligiblePeerCount = countMatchingPeers(
        peers, workflowSummaries,
        (peer) => peer.eligibleForConcurrency,
      );
      if (
        eligibleWithConcurrencyCount >= minimumPeerCount &&
        eligiblePeerCount > 0 &&
        eligibleWithConcurrencyCount / eligiblePeerCount >= minimumConsensusRatio
      ) {
        concurrency.push({
          workflowPath: summary.workflow.relativePath,
          peerCount: eligibleWithConcurrencyCount,
          peerWorkflowPaths: collectPeerLabels(
            peers, workflowSummaries,
            (peer) => peer.eligibleForConcurrency && peer.hasConcurrency,
            (peer) => peer.workflow.relativePath,
          ),
        });
      }
    }

    if (
      !workflowHasNonCodeIgnore(summary.workflow) &&
      !workflowHasTriggerPathFilter(summary.workflow) &&
      isHeavyWorkflow(summary.workflow) &&
      !workflowLooksMetaCheckLike(summary.workflow)
    ) {
      const peersWithIgnoreCount = countMatchingPeers(peers, workflowSummaries, (peer) =>
        workflowHasNonCodeIgnore(peer.workflow),
      );
      if (
        peersWithIgnoreCount >= minimumPeerCount &&
        peersWithIgnoreCount / peers.length >= minimumConsensusRatio
      ) {
        nonCodeIgnore.push({
          workflowPath: summary.workflow.relativePath,
          peerCount: peersWithIgnoreCount,
          peerWorkflowPaths: collectPeerLabels(
            peers, workflowSummaries,
            (peer) => workflowHasNonCodeIgnore(peer.workflow),
            (peer) => peer.workflow.relativePath,
          ),
        });
      }
    }

    if (
      !workflowHasTriggerPathFilter(summary.workflow) &&
      isHeavyWorkflow(summary.workflow)
    ) {
      const peersWithFilterCount = countMatchingPeers(peers, workflowSummaries, (peer) =>
        workflowHasTriggerPathFilter(peer.workflow),
      );
      if (
        peersWithFilterCount >= minimumPeerCount &&
        peersWithFilterCount / peers.length >= minimumConsensusRatio
      ) {
        pathsFilter.push({
          workflowPath: summary.workflow.relativePath,
          peerCount: peersWithFilterCount,
          peerWorkflowPaths: collectPeerLabels(
            peers, workflowSummaries,
            (peer) => workflowHasTriggerPathFilter(peer.workflow),
            (peer) => peer.workflow.relativePath,
          ),
        });
      }
    }
  }

  for (const [summaryIndex, summary] of jobSummaries.entries()) {
    const peers = jobPeerIndexes[summaryIndex] ?? [];

    if (summary.isTimeoutCandidate && !summary.hasTimeout) {
      const timeoutCandidatePeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isTimeoutCandidate,
      );
      const timeoutPeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isTimeoutCandidate && peer.hasTimeout,
      );
      if (
        timeoutCandidatePeerCount >= minimumPeerCount &&
        timeoutPeerCount / timeoutCandidatePeerCount >= minimumConsensusRatio
      ) {
        timeoutMinutes.push({
          workflowPath: summary.workflow.relativePath,
          jobId: summary.job.id,
          peerCount: timeoutPeerCount,
          peerJobLabels: collectPeerLabels(
            peers, jobSummaries,
            (peer) => peer.isTimeoutCandidate && peer.hasTimeout,
            (peer) => `${peer.workflow.relativePath}:${peer.job.id}`,
          ),
        });
      }
    }

    if (summary.isCacheCandidate && !summary.hasDependencyCache) {
      const cacheCandidatePeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isCacheCandidate,
      );
      const cachePeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isCacheCandidate && peer.hasDependencyCache,
      );
      if (
        cacheCandidatePeerCount >= minimumPeerCount &&
        cachePeerCount / cacheCandidatePeerCount >= minimumConsensusRatio
      ) {
        dependencyCache.push({
          workflowPath: summary.workflow.relativePath,
          jobId: summary.job.id,
          peerCount: cachePeerCount,
          peerJobLabels: collectPeerLabels(
            peers, jobSummaries,
            (peer) => peer.isCacheCandidate && peer.hasDependencyCache,
            (peer) => `${peer.workflow.relativePath}:${peer.job.id}`,
          ),
        });
      }
    }

    if (summary.isDeepCheckoutCandidate && summary.usesDeepCheckout) {
      const deepCheckoutCandidatePeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isDeepCheckoutCandidate,
      );
      const shallowCheckoutPeerCount = countMatchingPeers(
        peers, jobSummaries,
        (peer) => peer.isDeepCheckoutCandidate && !peer.usesDeepCheckout,
      );
      if (
        deepCheckoutCandidatePeerCount >= minimumPeerCount &&
        shallowCheckoutPeerCount / deepCheckoutCandidatePeerCount >= minimumConsensusRatio
      ) {
        deepCheckout.push({
          workflowPath: summary.workflow.relativePath,
          jobId: summary.job.id,
          peerCount: shallowCheckoutPeerCount,
          peerJobLabels: collectPeerLabels(
            peers, jobSummaries,
            (peer) => peer.isDeepCheckoutCandidate && !peer.usesDeepCheckout,
            (peer) => `${peer.workflow.relativePath}:${peer.job.id}`,
          ),
        });
      }
    }
  }

  return {
    concurrency,
    timeoutMinutes,
    dependencyCache,
    deepCheckout,
    pathsFilter,
    nonCodeIgnore,
  };
}

export function collectRepositoryPrecedentSignals(
  workflows: WorkflowDocument[],
  sharedJobSummaries?: JobSummary[],
): RepositoryPrecedentSignals {
  return collectRepositoryPrecedentSignalsFromPrecedents(
    workflows,
    sharedJobSummaries ?? collectJobSummaries(workflows),
  );
}
