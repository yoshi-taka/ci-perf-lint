import type { RuleMeta } from "../../types.ts";
import type { RepositorySignals } from "../../repository-signals-types.ts";

export const preferTailwindV4UpgradeToolMeta = {
  id: "prefer-tailwind-v4-upgrade-tool",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-tailwind-v4-upgrade-tool.md",
} satisfies RuleMeta;

export const tailwindV4Suggestion =
  "Run `npx @tailwindcss/upgrade` on a branch, review the diff carefully, and verify the app in a browser. Keep Tailwind v3.4 if the project must support browsers older than Safari 16.4, Chrome 111, or Firefox 128.";

export const tailwindV4MeasurementHint =
  "Compare frontend build time, CSS rebuild time, and representative page rendering before and after the Tailwind v4 migration.";

export function tailwindV4Score(usesVite: boolean): number {
  return usesVite ? 56 : 50;
}

export function checkTailwindV4UpgradeCandidate(
  tailwind: RepositorySignals["tailwind"],
): { versionSpec: string } | undefined {
  if (
    !tailwind.versionSpec ||
    tailwind.major !== 3 ||
    tailwind.usesConfigPlugins ||
    tailwind.hasLegacyBrowserTargets
  ) {
    return undefined;
  }
  return { versionSpec: tailwind.versionSpec };
}

export function tailwindV4ViteNote(usesVite: boolean): string {
  return usesVite
    ? " This repository also appears to use Vite, where Tailwind recommends the dedicated @tailwindcss/vite plugin for v4."
    : "";
}
