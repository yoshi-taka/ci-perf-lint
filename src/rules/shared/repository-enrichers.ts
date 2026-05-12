import type { Diagnostic } from "../../types.ts";
import type { DiagnosticEnricher } from "./diagnostic-enricher.ts";
import {
  appendPrecedent,
  renderPrecedentList,
  repositoryWorkflowPrecedents,
} from "./similar-workflow-consensus-shared.ts";

export interface PrecedentCtx {
  entries: readonly { workflowPath: string }[];
  lookups: ReadonlyMap<string, readonly string[]>;
  workflowPath: string;
  label: string;
  aiHandoff: string;
}

export const precedentEnricher: DiagnosticEnricher<PrecedentCtx> = {
  label: "repo-precedent",
  axes: ["why"] as const,
  enrich: (diagnostic: Diagnostic, ctx: PrecedentCtx) => {
    const precedents = repositoryWorkflowPrecedents(ctx.entries, ctx.workflowPath, ctx.lookups);
    return appendPrecedent(
      diagnostic,
      precedents.length > 0
        ? `This repository already uses ${ctx.label} in ${renderPrecedentList(precedents)}.`
        : undefined,
      precedents.length > 0 ? ctx.aiHandoff : undefined,
    );
  },
};

export interface ConsensusCtx {
  signal:
    | {
        peerCount: number;
        peerWorkflowPaths?: readonly string[];
      }
    | undefined;
  adjustment: { scoreBonus: number; why: string; aiHandoff: string };
  why: (evidence: { peerCount: number }, peerText: string) => string;
  peerText: string;
  aiHandoff: string;
}

export const consensusEnricher: DiagnosticEnricher<ConsensusCtx> = {
  label: "consensus",
  axes: ["score"] as const,
  enrich: (diagnostic: Diagnostic, ctx: ConsensusCtx) => {
    if (!ctx.signal) {
      return diagnostic;
    }
    const paths = ctx.signal.peerWorkflowPaths ?? [];
    const peerText =
      paths.length > 0 ? ` ${ctx.peerText} ${paths.map((p) => `\`${p}\``).join(", ")}.` : "";
    return {
      ...diagnostic,
      why: `${diagnostic.why} ${ctx.adjustment.why} ${ctx.why(ctx.signal, peerText)}`,
      aiHandoff: `${diagnostic.aiHandoff} ${ctx.adjustment.aiHandoff} ${ctx.aiHandoff}`,
      score: diagnostic.score + ctx.adjustment.scoreBonus,
    };
  },
};

export interface StackedDiffCtx {
  likelyUsed: boolean;
  evidenceText: string;
  adjustment: { scoreBonus: number; why: string; aiHandoff: string };
}

export const stackedDiffEnricher: DiagnosticEnricher<StackedDiffCtx> = {
  label: "stacked-diff",
  axes: ["why", "aiHandoff"] as const,
  enrich: (diagnostic: Diagnostic, ctx: StackedDiffCtx) => {
    if (!ctx.likelyUsed) {
      return diagnostic;
    }
    return {
      ...diagnostic,
      why: `${diagnostic.why} In a repository that appears to use stacked diffs, restacks can update several PR branches and rerun CI even when an upstack diff did not logically change. ${ctx.adjustment.why} ${ctx.evidenceText}`,
      aiHandoff: `${diagnostic.aiHandoff} ${ctx.adjustment.aiHandoff} Because stacked diff usage is likely here, preserve required-check semantics while prioritizing changes that reduce restack-triggered duplicate CI.`,
      score: diagnostic.score + ctx.adjustment.scoreBonus,
    };
  },
};
