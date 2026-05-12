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
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/missing-concurrency.md",
  maxFindings: 3,
  skipIf: or(workflowFact("isHeavyWorkflow", false), workflowFact("hasConcurrency", true)),
  impliedChecks: ["missing-timeout-minutes"],
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
      severity: agentic ? "warning" : undefined,
      why: agentic
        ? "Agentic and AI-assisted runs are often long-lived, so older runs can keep burning runner time after newer commits or comments arrive on the same PR or branch."
        : "Older runs can continue burning runner time after newer commits arrive on the same PR or branch.",
      suggestion: "Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.",
      measurementHint:
        "Push multiple commits to the same PR and confirm only the latest run continues.",
      aiHandoff: `Add safe concurrency to ${workflow.relativePath}, ideally scoped by workflow and ref, and keep existing behavior intact.`,
      score: agentic ? 62 : 58,
    });

    const enrich = composeEnrichers(
      contramap(precedentEnricher, (ctx: RuleContext) => ({
        entries: ctx.repository.repoPrecedents.concurrency,
        lookups: ctx.repository.repoPrecedents.lookups.concurrency,
        workflowPath: workflow.relativePath,
        label: "concurrency",
        aiHandoff:
          "Reuse one of the repository's existing concurrency patterns where it fits this workflow.",
      })),
      contramap(consensusEnricher, (ctx: RuleContext) => ({
        signal: ctx.repository.similarWorkflows.index.concurrency.get(workflow.relativePath),
        adjustment: {
          scoreBonus: 8,
          why: "That makes this look more like a repository-local normalization gap than a one-off design choice.",
          aiHandoff:
            "Prefer the repository's existing concurrency pattern over inventing a new grouping strategy unless this workflow has clearly different cancellation requirements.",
        },
        why: (evidence, peerText) =>
          `In this repository, ${evidence.peerCount} similar workflows already use concurrency.${peerText}`,
        peerText: "Similar workflows already using concurrency include",
        aiHandoff:
          "Match the established concurrency pattern already used in similar workflows where it fits this workflow's trigger semantics.",
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
            why: "Concurrency is more valuable because superseded runs from restacks can otherwise keep consuming runner time.",
            aiHandoff:
              "Use a concurrency group scoped to the workflow and PR/head ref so newer restack runs cancel older runs from the same branch without canceling unrelated PRs.",
          },
        };
      }),
    );

    return [taggedPipe(toTaggedEnrich(enrich, context))(base)];
  },
};
