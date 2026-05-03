import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-nextest-for-heavy-rust-tests",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextest-for-heavy-rust-tests.md",
} satisfies RuleMeta;

export function collectPreferNextestForHeavyRustTestsDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const { hasCargoToml, usesNextest, hasWorkspace, workspaceMemberCount } = repository.rust;
  if (!hasCargoToml || usesNextest) {
    return [];
  }

  const memberCount = workspaceMemberCount ?? 0;
  const looksHeavy = (hasWorkspace && memberCount !== 1) || memberCount >= 3;

  if (!looksHeavy) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "Cargo.toml", line: 1, column: 1 },
      message:
        "Repository has a heavy-looking Rust test setup without visible cargo-nextest adoption.",
      why: "cargo-nextest can reduce Rust test wall-clock time on larger workspaces and multi-binary test suites by running tests with a CI-oriented execution model. It does not replace doctests, so doctest coverage may need a separate cargo test --doc step.",
      suggestion:
        "Trial cargo-nextest for this Rust test path, for example by installing cargo-nextest and replacing the heavy cargo test command with cargo nextest run while keeping cargo test --doc if doctests matter.",
      measurementHint:
        "Compare cargo test versus cargo nextest run wall-clock time on the same runner, target set, and feature set before changing the default CI path.",
      aiHandoff: `Review the repository Cargo.toml and Rust test setup. If the workspace has ${memberCount} member(s), trial cargo nextest run with equivalent feature/workspace flags, and keep a separate cargo test --doc step if doctests are required.`,
      score: 43,
    }),
  ];
}
