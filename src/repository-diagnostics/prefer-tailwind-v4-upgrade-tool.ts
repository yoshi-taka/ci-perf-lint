import type { AnalysisWarning, Diagnostic } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  preferTailwindV4UpgradeToolMeta as meta,
  checkTailwindV4UpgradeCandidate,
  tailwindV4ViteNote,
  tailwindV4Suggestion,
  tailwindV4MeasurementHint,
  tailwindV4Score,
} from "../rules/shared/tailwind-versions.ts";

export function collectPreferTailwindV4UpgradeToolDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
): Diagnostic[] {
  const candidate = checkTailwindV4UpgradeCandidate(repository.tailwind);
  if (!candidate) {
    return [];
  }

  const viteNote = tailwindV4ViteNote(repository.frameworks.usesVite);

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: { path: "package.json", line: 1, column: 1 },
      message: `The repository is on Tailwind CSS ${candidate.versionSpec}; this is a good candidate for trying the official v4 upgrade tool first.`,
      why: `Tailwind's v4 guide says the upgrade tool handles most v3 to v4 migration work, including dependency updates, CSS-based config migration, and template class changes. This rule only fires when no obvious Tailwind config plugins or legacy browser targets were found.${viteNote}`,
      suggestion: tailwindV4Suggestion,
      measurementHint: tailwindV4MeasurementHint,
      aiHandoff: `Review the Tailwind CSS ${candidate.versionSpec} setup. If browser support allows modern Tailwind v4 targets, run \`npx @tailwindcss/upgrade\` on a branch, inspect dependency/config/template changes, and verify visual output in the browser. Official guide: https://tailwindcss.com/docs/upgrade-guide`,
      score: tailwindV4Score(repository.frameworks.usesVite),
    }),
  ];
}
