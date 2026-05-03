import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-lefthook-for-complex-git-hooks",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-lefthook-for-complex-git-hooks.md",
} satisfies RuleMeta;

function hookComplexityScore(husky: RepositorySignals["husky"]): number {
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

export function collectPreferLefthookForComplexGitHooksDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const husky = repository.husky;
  if (!husky.usesHusky && !husky.usesLintStaged) {
    return [];
  }

  const complexityScore = hookComplexityScore(husky);
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
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: ".husky", line: 1, column: 1 },
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
}
