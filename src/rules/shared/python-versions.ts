import type { RuleMeta } from "../../types.ts";

export const preferPython311Meta = {
  id: "prefer-python-3-11",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-python-3-11.md",
} satisfies RuleMeta;

const milestoneMajor = 3;
const milestoneMinor = 11;

export function pythonVersionIsBelow311(major?: number, minor?: number): boolean {
  if (major === undefined || minor === undefined) {
    return false;
  }
  if (major < milestoneMajor) {
    return true;
  }
  return major === milestoneMajor && minor < milestoneMinor;
}

/** Extracts the first `major.minor` version literal from a version file. */
export function extractPythonVersionLiteral(
  text: string,
): { major: number; minor: number } | undefined {
  const match = text.match(/(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/**
 * Detects a `requires-python` / `python_requires` constraint that cannot
 * resolve to 3.11+. A floor-only constraint such as `>=3.9` is not flagged
 * because it can already install on 3.11+.
 */
export function requiresPythonConstrainsBelow311(spec: string): boolean {
  const cleaned = spec
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(";")[0]!
    .replace(/\s+/g, "");
  if (!cleaned) {
    return false;
  }

  for (const match of cleaned.matchAll(/==(\d+)\.(\d+)/g)) {
    if (pythonVersionIsBelow311(Number(match[1]), Number(match[2]))) {
      return true;
    }
  }

  if (!/[<>=]/.test(cleaned)) {
    const bare = extractPythonVersionLiteral(cleaned);
    if (bare && pythonVersionIsBelow311(bare.major, bare.minor)) {
      return true;
    }
  }

  for (const match of cleaned.matchAll(/<(=?)(\d+)\.(\d+)/g)) {
    const major = Number(match[2]);
    const minor = Number(match[3]);
    if (major < milestoneMajor) {
      return true;
    }
    if (major === milestoneMajor && minor < milestoneMinor) {
      return true;
    }
    if (major === milestoneMajor && minor === milestoneMinor && match[1] === "") {
      return true;
    }
  }

  return false;
}

export const preferPython311Why =
  "Python 3.11 is the Faster CPython milestone: the pyperformance suite reports 10-60% faster execution than 3.10 (about 1.25x on average), with 10-15% faster interpreter startup. Total CI savings depend on the workload; downloads, native tools, and compatibility tests may not benefit. Older-runtime support and lifecycle policy must be evaluated separately.";

export const preferPython311Suggestion =
  "Try Python 3.11+ for tooling jobs that do not require an older runtime. Preserve supported-version compatibility tests and package support declarations; do not raise requires-python solely to speed up CI. Keep the runtime change only if tests pass and total job time improves.";

export const preferPython311MeasurementHint =
  "Compare Python job wall-clock time, import/startup time, and test duration before and after moving the runtime to 3.11 or newer.";
