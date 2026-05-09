import type { Diagnostic } from "../../types.ts";
import type { RuleContext } from "../../rule-engine.ts";
import type { DiagnosticTransform } from "./diagnostic-transform.ts";

interface StackedDiffAdjustment {
  scoreBonus: number;
  why: string;
  aiHandoff: string;
}

function stackedDiffEvidenceText(context: RuleContext): string {
  const provider =
    context.repository.stackedDiffs.provider === "graphite"
      ? "Graphite/stacked diff"
      : context.repository.stackedDiffs.provider === "github"
        ? "GitHub gh-stack"
        : context.repository.stackedDiffs.provider === "ghstack"
          ? "ghstack"
          : "stacked diff";
  const evidence = context.repository.stackedDiffs.evidence[0];
  return evidence ? `${provider} evidence: ${evidence}.` : `${provider} evidence was found.`;
}

export function withStackedDiffContext(
  context: RuleContext,
  adjustment: StackedDiffAdjustment,
): DiagnosticTransform {
  return (diagnostic: Diagnostic) => {
    if (!context.repository.stackedDiffs.likelyUsed) {
      return diagnostic;
    }

    return {
      ...diagnostic,
      why: `${diagnostic.why} In a repository that appears to use stacked diffs, restacks can update several PR branches and rerun CI even when an upstack diff did not logically change. ${adjustment.why} ${stackedDiffEvidenceText(context)}`,
      aiHandoff: `${diagnostic.aiHandoff} ${adjustment.aiHandoff} Because stacked diff usage is likely here, preserve required-check semantics while prioritizing changes that reduce restack-triggered duplicate CI.`,
      score: diagnostic.score + adjustment.scoreBonus,
    };
  };
}
