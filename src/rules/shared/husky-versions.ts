import type { RuleMeta } from "../../types.ts";

export const outdatedHuskyVersionMeta = {
  id: "outdated-husky-version",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/outdated-husky-version.md",
} satisfies RuleMeta;

export const outdatedHuskySuggestion =
  "Upgrade Husky to the latest v9 release, then simplify hook scripts to avoid deprecated bootstrap and unnecessary x-runner usage.";

export const outdatedHuskyMeasurementHint =
  "Compare local pre-commit or commit-msg hook startup time before and after upgrading Husky and simplifying hook scripts.";

export function outdatedHuskyMessage(versionSpec: string): string {
  return `The repository uses Husky ${versionSpec}, which is at or below 9.1.1.`;
}

export function outdatedHuskyScore(major: number | undefined): number {
  return major !== undefined && major < 9 ? 60 : 53;
}

export function isAtOrBelowHusky911(
  major: number | undefined,
  minor: number | undefined,
  patch: number | undefined,
): boolean {
  if (major === undefined) {
    return false;
  }

  if (major < 9) {
    return true;
  }

  if (major > 9 || minor === undefined) {
    return false;
  }

  if (minor < 1) {
    return true;
  }

  if (minor > 1) {
    return false;
  }

  return (patch ?? 0) < 2;
}
