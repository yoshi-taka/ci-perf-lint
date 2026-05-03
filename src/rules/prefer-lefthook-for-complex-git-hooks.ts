import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

// Sources:
// - https://lefthook.dev/
// - https://github.com/evilmartians/lefthook
const meta = {
  id: "prefer-lefthook-for-complex-git-hooks",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-lefthook-for-complex-git-hooks.md",
} satisfies RuleMeta;

function hookComplexityScore(context: RuleContext): number {
  const husky = context.repository.husky;
  let score = 0;

  if (husky.hookFileCount >= 2) {
    score += 2;
  }
  if (husky.nonPreCommitHookCount >= 1) {
    score += 2;
  }
  if (husky.multiCommandHookCount >= 1) {
    score += 2;
  }
  if (husky.totalHookCommandCount >= 4) {
    score += 1;
  }
  if (husky.usesLintStaged) {
    score += 1;
  }
  if (husky.lintStagedPatternCount >= 2) {
    score += 2;
  }
  if (husky.lintStagedCommandCount >= 3) {
    score += 1;
  }

  return score;
}

export const preferLefthookForComplexGitHooksRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const husky = context.repository.husky;
    if (
      (!husky.usesHusky && !husky.usesLintStaged) ||
      (context.repository.primaryWorkflowPath !== undefined &&
        workflow.relativePath !== context.repository.primaryWorkflowPath)
    ) {
      return [];
    }

    const complexityScore = hookComplexityScore(context);
    const isSimpleSingleHook =
      husky.hookFileCount <= 1 &&
      husky.nonPreCommitHookCount === 0 &&
      husky.totalHookCommandCount <= 1 &&
      husky.lintStagedPatternCount <= 1 &&
      husky.lintStagedCommandCount <= 1;

    if (isSimpleSingleHook || complexityScore < 4) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        scope: "repository",
        message:
          "Repository git-hook setup looks moderately complex and may be easier to manage with Lefthook.",
        why: `This repository appears to combine ${husky.hookFileCount} hook file(s), ${husky.totalHookCommandCount} hook command block(s), and ${husky.lintStagedPatternCount} lint-staged pattern(s). For multi-step git-hook orchestration, Lefthook can be easier to maintain and can reduce ad hoc shell glue.`,
        suggestion:
          "If these hooks are expected to keep growing, consider consolidating Husky or lint-staged orchestration under Lefthook rather than extending shell-based hooks further.",
        measurementHint:
          "Compare local hook startup time and config complexity after migrating a representative pre-commit or commit-msg flow to Lefthook.",
        aiHandoff:
          "Review the repository hook topology, especially multi-step pre-commit, commit-msg, pre-push, and lint-staged flows, and consider Lefthook only if the current shell-based setup is becoming hard to maintain.",
        score: 28 + complexityScore,
      }),
    ];
  },
};
