import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { RuleMeta } from "../types.ts";
import { workflowLooksAgenticLike } from "./shared/workflow-jobs.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { taggedPipe } from "./shared/diagnostic-transform.ts";
import { contramap, composeEnrichers, toTaggedEnrich } from "./shared/diagnostic-enricher.ts";
import {
  precedentEnricher,
  consensusEnricher,
  stackedDiffEnricher,
} from "./shared/repository-enrichers.ts";
import { workflowFact, or } from "./shared/predicate.ts";

const meta = {
  id: "missing-concurrency",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/missing-concurrency.md",
  maxFindings: 3,
  skipIf: or(workflowFact("isHeavyWorkflow", false), workflowFact("hasConcurrency", true)),
  impliedChecks: ["missing-timeout-minutes"] as const,
} satisfies RuleMeta;

export const missingConcurrencyRule = {
  meta,
  nodeTypes: ["trigger"],
  check(workflow: WorkflowDocument, context: RuleContext) {
    const ts = getTriggerSemantics(workflow);

    if (!ts.hasPullRequest && !ts.hasPush) {
      context.abstain?.(
        {
          ruleId: meta.id,
          jobId: "",
          reason: "condition-not-met",
          detail: "no PR or push trigger",
        },
        "known-absent",
      );
      return [];
    }

    if (!ts.hasPullRequest && ts.hasTagOnlyPush) {
      context.abstain?.(
        { ruleId: meta.id, jobId: "", reason: "condition-not-met", detail: "tag-only push" },
        "known-absent",
      );
      return [];
    }

    if (!ts.hasPullRequest && ts.hasPush && ts.hasTriggerPathFilter) {
      context.abstain?.(
        {
          ruleId: meta.id,
          jobId: "",
          reason: "condition-not-met",
          detail: "push with path filter",
        },
        "known-absent",
      );
      return [];
    }

    const agentic = workflowLooksAgenticLike(workflow);

    const base = buildDiagnostic(workflow, meta, workflow.onNode ?? workflow.nameNode, {
      message: "The workflow has no workflow-level or job-level concurrency setting.",
      why: agentic
        ? "Agentic and AI-assisted runs are often long-lived, so superseded read-only checks can keep burning runner time. Publication and deployment runs may instead need to finish and retain every queued release."
        : "Superseded read-only checks can waste runner time, but publication and deployment runs may need to finish and retain every queued release.",
      suggestion:
        "Cancel superseded read-only PR/branch checks only, preferably at job level. Do not cancel release/publish/deploy work. For serialized publication consider cancel-in-progress: false with queue: max (up to 100 pending); this is not a lossless release queue or a dispatch-order guarantee.",
      measurementHint:
        "For read-only checks, confirm superseded runs stop without canceling unrelated checks. For publication, verify in-progress completion, queued-release retention and required ordering under bursts.",
      aiHandoff: `Review ${workflow.relativePath} before adding concurrency. Isolate superseded read-only validation from publication/deployment, including opaque scripts and reusable workflows. Do not cancel publication or copy a latest-only CI group onto it. Default concurrency replaces pending runs even with cancel-in-progress: false; queue: max retains at most 100 pending and does not guarantee dispatch order. Use a durable queue if every release must run.`,
      score: agentic ? 62 : 58,
    });

    const enrich = composeEnrichers(
      contramap(precedentEnricher, (ctx: RuleContext) => ({
        entries: ctx.repository.repoPrecedents.concurrency,
        lookups: ctx.repository.repoPrecedents.lookups.concurrency,
        workflowPath: workflow.relativePath,
        label: "concurrency",
        aiHandoff:
          "Reuse an existing concurrency pattern only after checking its cancellation and pending-queue policy; never copy latest-only CI cancellation onto publication.",
      })),
      contramap(consensusEnricher, (ctx: RuleContext) => ({
        signal: ctx.repository.similarWorkflows.index.concurrency.get(workflow.relativePath),
        adjustment: {
          scoreBonus: 8,
          why: "That makes this look more like a repository-local normalization gap than a one-off design choice.",
          aiHandoff:
            "Prefer an existing pattern only when its cancellation, pending-queue and publication requirements match; repository precedent does not establish cancellation safety.",
        },
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already use concurrency.${peerText}`,
        peerText: "Similar workflows already using concurrency include",
        aiHandoff:
          "Match established concurrency only where trigger, cancellation and queued-release retention requirements agree.",
      })),
      contramap(stackedDiffEnricher, (ctx: RuleContext) => {
        const provider =
          ctx.repository.stackedDiffs.provider === "graphite"
            ? "Graphite/stacked diff"
            : ctx.repository.stackedDiffs.provider === "github"
              ? "GitHub gh-stack"
              : ctx.repository.stackedDiffs.provider === "ghstack"
                ? "ghstack"
                : "stacked diff";
        const evidence = ctx.repository.stackedDiffs.evidence[0];
        const evidenceText = evidence
          ? `${provider} evidence: ${evidence}.`
          : `${provider} evidence was found.`;
        return {
          likelyUsed: ctx.repository.stackedDiffs.likelyUsed,
          evidenceText,
          adjustment: {
            scoreBonus: 10,
            why: "For read-only validation, superseded runs from restacks can otherwise keep consuming runner time; this does not justify canceling publication.",
            aiHandoff:
              "For superseded read-only PR validation only, scope cancellation by workflow and PR/head ref. Keep publication/deployment outside the canceling group and preserve unrelated PRs.",
          },
        };
      }),
    );

    return [taggedPipe(toTaggedEnrich(enrich, context))(base)];
  },
};
