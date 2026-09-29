export const outdatedPydanticV2Suggestion =
  "Raise the pydantic requirement to >=2.11 (2.11.x or newer).";

export const outdatedPydanticV2MeasurementHint =
  "Compare model import, schema-build/startup time, and peak memory in CI before and after upgrading pydantic.";

export function outdatedPydanticV2Message(spec: string, fileName: string): string {
  return `Pydantic is constrained to ${spec} in ${fileName}, a v2 release older than 2.11.`;
}

export const outdatedPydanticV2Why =
  "Pydantic 2.9 and 2.11 introduced substantial schema-build/startup improvements. 2.9 cut import times (~35% faster `import pydantic`, up to 10x in model-heavy files) and sped up schema building, while 2.11 delivered up to 2x faster schema build times and a 2-5x reduction in model schema memory. Staying below 2.11 keeps CI on the slower schema-build path.";

type Triple = readonly [number, number, number];

const v2Milestone: Triple = [2, 11, 0];
const v2Floor: Triple = [2, 0, 0];

function compare(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i]! < b[i]! ? -1 : 1;
    }
  }
  return 0;
}

function caretUpper(major: number, minor: number, patch: number): Triple {
  if (major > 0) {
    return [major + 1, 0, 0];
  }
  if (minor > 0) {
    return [0, minor + 1, 0];
  }
  return [0, 0, patch + 1];
}

function wildcardUpper(major: number, minor: number, hasMinor: boolean): Triple {
  return hasMinor ? [major, minor + 1, 0] : [major + 1, 0, 0];
}

const tokenPattern = /^(\^|~=|~|==|!=|>=|<=|>|<)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(\.\*)?$/;

/**
 * Detects a pydantic v2 requirement that cannot resolve to >= 2.11.
 *
 * A floor-only requirement such as `>=2.0` is not flagged because it can
 * resolve to a current 2.11+ release. Exact pins, compatible-release
 * specifiers, and explicit upper bounds below 2.11 are flagged.
 */
export function pydanticV2SpecIsOutdated(spec: string): boolean {
  const cleaned = spec
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(";")[0]!
    .trim();
  if (!cleaned) {
    return false;
  }

  let lower: Triple | undefined;
  let upper: Triple | undefined;
  let upperInclusive = false;

  const raiseLower = (value: Triple): void => {
    if (!lower || compare(value, lower) > 0) {
      lower = value;
    }
  };
  const tightenUpper = (value: Triple, inclusive: boolean): void => {
    if (!upper) {
      upper = value;
      upperInclusive = inclusive;
      return;
    }
    const result = compare(value, upper);
    if (result < 0) {
      upper = value;
      upperInclusive = inclusive;
    } else if (result === 0) {
      upperInclusive = upperInclusive && inclusive;
    }
  };

  for (const rawToken of cleaned.split(",")) {
    const match = tokenPattern.exec(rawToken.trim());
    if (!match) {
      continue;
    }

    const operator = match[1] ?? "";
    const major = Number(match[2]);
    const hasMinor = match[3] !== undefined;
    const hasPatch = match[4] !== undefined;
    const minor = hasMinor ? Number(match[3]) : 0;
    const patch = hasPatch ? Number(match[4]) : 0;
    const wildcard = Boolean(match[5]);
    const value: Triple = [major, minor, patch];

    if (operator === "!=") {
      continue;
    }
    if (operator === ">=" || operator === ">") {
      raiseLower(value);
      continue;
    }
    if (operator === "<") {
      tightenUpper(value, false);
      continue;
    }
    if (operator === "<=") {
      tightenUpper(value, true);
      continue;
    }
    if (operator === "==") {
      raiseLower(value);
      tightenUpper(wildcard ? wildcardUpper(major, minor, hasMinor) : value, !wildcard);
      continue;
    }
    if (operator === "^") {
      raiseLower(value);
      tightenUpper(caretUpper(major, minor, patch), false);
      continue;
    }
    if (operator === "~") {
      raiseLower(value);
      tightenUpper([hasMinor ? major : major + 1, hasMinor ? minor + 1 : 0, 0], false);
      continue;
    }
    if (operator === "~=") {
      raiseLower(value);
      tightenUpper(hasPatch ? [major, minor + 1, 0] : [major + 1, 0, 0], false);
      continue;
    }

    raiseLower(value);
    if (wildcard) {
      tightenUpper(wildcardUpper(major, minor, hasMinor), false);
    } else {
      tightenUpper(value, true);
    }
  }

  if (!lower || compare(lower, v2Floor) < 0 || compare(lower, v2Milestone) >= 0) {
    return false;
  }
  if (!upper) {
    return false;
  }

  const result = compare(upper, v2Milestone);
  return result < 0 || (result === 0 && !upperInclusive);
}
