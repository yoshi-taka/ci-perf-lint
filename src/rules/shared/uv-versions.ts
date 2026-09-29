import type { RuleMeta } from "../../types.ts";

export const preferModernUvVersionMeta = {
  id: "prefer-uv-0-10",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-uv-0-10.md",
} satisfies RuleMeta;

const modernUvMinorFloor = 10;

export const preferModernUvVersionSuggestion =
  "Raise the uv floor to at least 0.10.x so CI installs a current uv. Update setup-uv version inputs, pip or pipx uv pins, and pyproject/uv.toml required-version constraints together.";

export const preferModernUvVersionMeasurementHint =
  "Compare Python dependency resolution and install wall-clock time before and after moving uv to 0.10.x or newer.";

type VersionPair = readonly [major: number, minor: number];

function isBelowModern([major, minor]: VersionPair): boolean {
  return major === 0 && minor < modernUvMinorFloor;
}

function isAtOrAboveModern([major, minor]: VersionPair): boolean {
  return major > 0 || (major === 0 && minor >= modernUvMinorFloor);
}

/**
 * Detects whether a uv version or version constraint forces an effective uv
 * below 0.10. Bare versions and lower bounds are treated as the floor; an
 * upper bound below 0.10 also forces an outdated uv.
 */
export function uvVersionSpecIsBelowModern(spec: string | undefined): boolean {
  if (!spec) {
    return false;
  }

  const text = spec
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
  if (!text || /^(latest|stable|nightly|main|master)$/.test(text)) {
    return false;
  }

  const lowerBounds: VersionPair[] = [];
  const upperExclusive: VersionPair[] = [];
  const upperInclusive: VersionPair[] = [];
  const pattern = /(>=|<=|==|~=|\^|>|<)?\s*v?(\d+)\.(\d+)(?:\.(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const operator = match[1] ?? "";
    const pair: VersionPair = [Number(match[2]), Number(match[3])];
    if (operator === "<") {
      upperExclusive.push(pair);
    } else if (operator === "<=") {
      upperInclusive.push(pair);
    } else {
      lowerBounds.push(pair);
    }
  }

  if (lowerBounds.some(isAtOrAboveModern)) {
    return false;
  }
  if (lowerBounds.some(isBelowModern)) {
    return true;
  }
  if (upperExclusive.some(([major, minor]) => major === 0 && minor <= modernUvMinorFloor)) {
    return true;
  }
  return upperInclusive.some(isBelowModern);
}

const uvInstallPattern =
  /\b(?:pip3?|python\s+-m\s+pip|pipx)\s+install\b[^\n;&|]*?\buv\b([^\s;&|"']*)/i;

/** Extracts the version specifier pinned to a shell uv install, if any. */
export function extractPinnedUvInstallSpec(run: string): string | undefined {
  const match = uvInstallPattern.exec(run);
  const spec = match?.[1]?.trim();
  return spec && /[<>=!~^]/.test(spec) ? spec : undefined;
}
