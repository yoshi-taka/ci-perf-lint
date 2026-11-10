import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findPrettierEvidenceLocation } from "./prettier-evidence.ts";

// Sources:
// - https://bun.com/docs/format
// - https://bun.com/guides/format/migrate-from-prettier
const meta = {
  id: "prefer-bun-fmt-over-prettier",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-bun-fmt-over-prettier.md",
} satisfies RuleMeta;

export async function collectPreferBunFmtOverPrettierDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesPrettier, usesOxfmt, usesBunFmt, pluginNames } = repository.prettier;
  if (repository.npm.packageManager !== "bun" || !usesPrettier || usesOxfmt || usesBunFmt) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const location = await findPrettierEvidenceLocation(repoRoot, context);
  const pluginNote =
    pluginNames.length > 0
      ? ` Visible Prettier plugins may need a fallback review: ${pluginNames.join(", ")}.`
      : "";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      severity: "warning",
      location,
      message: "Repository uses Bun and Prettier without visible `bun fmt` adoption.",
      why: `Bun 1.4+ ships a built-in formatter with Prettier-compatible output that reads an existing \`.prettierrc\` or \`.oxfmtrc.json\`, so a Bun repository can format without installing Prettier or Oxfmt. \`bun fmt --check\` works in CI, and \`bun fmt --staged\` formats staged files without lint-staged.${pluginNote}`,
      suggestion:
        "Replace the Prettier dependency and entrypoint with `bun fmt` (or `bun fmt --check` in CI) after confirming output parity on the repository's files.",
      measurementHint:
        "Compare formatter step duration and diff output on the same file set before changing CI defaults.",
      aiHandoff:
        "Review the formatter scripts, CI steps, and hooks together. Confirm the repository runs Bun 1.4 or newer, verify `bun fmt` output against Prettier on the repository's files, then replace the Prettier dependency and entrypoint. If package.json defines a `fmt` script, use `bun fmt --no-script` or rename that script so `bun fmt` runs the built-in formatter.",
      score: 46,
    }),
  ];
}
