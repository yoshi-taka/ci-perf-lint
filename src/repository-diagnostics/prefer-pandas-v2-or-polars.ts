import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-pandas-v2-or-polars",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-pandas-v2-or-polars.md",
} satisfies RuleMeta;

type Version = readonly [number, number, number];
interface Pin {
  spec: string;
  line: number;
}

function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }
  return 0;
}

/** Detect legacy support in the requirement, not the version installed by a resolver. */
function allowsLegacyPandas(spec: string): boolean {
  let lower: Version = [0, 0, 0];
  let lowerInclusive = true;
  let upper: Version | undefined;
  let upperInclusive = false;
  for (const token of spec.split(";")[0]!.trim().split(",")) {
    const match = /^(\^|~=|~|==|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(\.\*)?$/.exec(
      token.trim(),
    );
    if (!match) {
      return false;
    }
    const operator = match[1] ?? "==";
    const major = Number(match[2]);
    const minor = Number(match[3] ?? 0);
    const patch = Number(match[4] ?? 0);
    const version: Version = [major, minor, patch];
    let tokenLower: Version | undefined;
    let tokenUpper: Version | undefined;
    let tokenLowerInclusive = true;
    let tokenUpperInclusive = false;
    if (operator === ">" || operator === ">=") {
      if (match[5]) {
        return false;
      }
      tokenLower = version;
      tokenLowerInclusive = operator === ">=";
    } else if (operator === "<" || operator === "<=") {
      if (match[5]) {
        return false;
      }
      tokenUpper = version;
      tokenUpperInclusive = operator === "<=";
    } else {
      tokenLower = version;
      if (match[5]) {
        tokenUpper = match[3] === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
      } else if (operator === "^") {
        tokenUpper = major > 0 ? [major + 1, 0, 0] : [major, minor + 1, 0];
      } else if (operator === "~" || operator === "~=") {
        tokenUpper =
          match[3] === undefined || (operator === "~=" && match[4] === undefined)
            ? [major + 1, 0, 0]
            : [major, minor + 1, 0];
      } else {
        tokenUpper = version;
        tokenUpperInclusive = true;
      }
    }
    if (tokenLower) {
      const order = compare(tokenLower, lower);
      if (order > 0) {
        lower = tokenLower;
        lowerInclusive = tokenLowerInclusive;
      } else if (order === 0) {
        lowerInclusive &&= tokenLowerInclusive;
      }
    }
    if (tokenUpper) {
      const order = upper ? compare(tokenUpper, upper) : -1;
      if (order < 0) {
        upper = tokenUpper;
        upperInclusive = tokenUpperInclusive;
      } else if (order === 0) {
        upperInclusive &&= tokenUpperInclusive;
      }
    }
  }
  const rangeOrder = upper ? compare(lower, upper) : -1;
  return (
    (rangeOrder < 0 || (rangeOrder === 0 && lowerInclusive && upperInclusive)) &&
    compare(lower, [2, 0, 0]) < 0
  );
}

function lockPins(text: string): Pin[] {
  const pins: Pin[] = [];
  let inPackage = false;
  let name: string | undefined;
  let version: Pin | undefined;
  const finish = (): void => {
    if (name === "pandas") {
      pins.push(version ?? { spec: "", line: 1 });
    }
  };
  for (const [index, line] of text.split("\n").entries()) {
    if (/^\s*\[/.test(line)) {
      finish();
      name = undefined;
      version = undefined;
      inPackage = /^\s*\[\[package\]\]\s*(?:#.*)?$/.test(line);
    } else if (inPackage) {
      const nameMatch = /^\s*name\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(line);
      const versionMatch = /^\s*version\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(line);
      if (nameMatch) {
        name = nameMatch[1];
      }
      if (versionMatch) {
        version = { spec: versionMatch[1]!, line: index + 1 };
      }
    }
  }
  finish();
  return pins;
}

function declarationPin(fileName: string, text: string): Pin | undefined {
  let section = "";
  let arrayDepth = 0;
  let inInstallRequires = false;
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw
      .replace(/"(?:\\.|[^"\\])*"|'[^']*'|#.*$/g, (part) => (part.startsWith("#") ? "" : part))
      .trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1]!;
      arrayDepth = 0;
      inInstallRequires = false;
      continue;
    }
    let specs: string[] = [];
    if (fileName.endsWith(".txt")) {
      const requirement = /^pandas(?![\w.-])(?:\[[\w, .-]+\])?\s*([^#]*)/i.exec(line);
      if (requirement) {
        specs = [requirement[1]!.trim()];
      }
    } else if (fileName === "setup.cfg") {
      if (/^\S/.test(raw)) {
        inInstallRequires = section === "options" && /^install_requires\s*=/.test(line);
      }
      if (inInstallRequires) {
        const requirement = /^pandas(?![\w.-])(?:\[[\w, .-]+\])?\s*([^#]*)/i.exec(
          line.replace(/^install_requires\s*=\s*/, ""),
        );
        if (requirement) {
          specs = [requirement[1]!.trim()];
        }
      }
    } else {
      const dependencyTable =
        /^tool\.poetry(?:\.group\.[\w-]+)?\.dependencies$/.test(section) ||
        (fileName === "Pipfile" && ["packages", "dev-packages"].includes(section));
      const key = /^["']?pandas["']?\s*=\s*(.+)$/.exec(line);
      if (dependencyTable && key) {
        const value = key[1]!;
        const version = /^(?:["']([^"']+)["']|\{[^}]*\bversion\s*=\s*["']([^"']+)["'])/.exec(value);
        if (version) {
          specs = [version[1] ?? version[2]!];
        }
      }
      if (
        (section === "project" && (arrayDepth > 0 || /^dependencies\s*=\s*\[/.test(line))) ||
        section === "project.optional-dependencies" ||
        section === "dependency-groups"
      ) {
        for (const match of line.matchAll(/(["'])pandas(?![\w.-])(?:\[[\w, .-]+\])?\s*(.*?)\1/gi)) {
          specs.push(match[2]!.trim());
        }
        const structure = line.replace(/"(?:\\.|[^"\\])*"|'[^']*'|#.*$/g, "");
        arrayDepth += (structure.match(/\[/g)?.length ?? 0) - (structure.match(/\]/g)?.length ?? 0);
      }
    }
    const spec = specs.find(allowsLegacyPandas);
    if (spec !== undefined) {
      return { spec, line: index + 1 };
    }
  }
  return undefined;
}

export async function collectPreferPandasV2OrPolarsDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const build = (fileName: string, pin: Pin, resolved = false): Diagnostic[] => [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: fileName, line: pin.line, column: 1 },
      message: resolved
        ? `${fileName} resolves pandas ${pin.spec}, below pandas 2.`
        : `${fileName} allows pandas versions below 2 (${pin.spec}); raise the minimum version.`,
      why: "CI tests and data-processing jobs inherit the repository's pandas dependency policy. pandas 2+ provides newer performance improvements and opt-in Arrow-backed data and Copy-on-Write optimizations; Polars offers parallel and lazy dataframe execution. Requiring a modern baseline avoids retaining the legacy pandas path, although the savings depend on the operations, installed version, and configuration.",
      suggestion:
        "Require pandas >=2 and update resolved old versions to a compatible 2.x or newer release, or migrate suitable dataframe processing to Polars. Preserve dtype, index, missing-value, ordering, and mutation semantics, and retain intentional old-version compatibility coverage.",
      measurementHint:
        "Compare test fixture setup, data-processing test duration, peak memory, dependency installation, and total CI time before and after upgrading. Verify identical results; a version upgrade alone does not enable every Arrow or Copy-on-Write optimization.",
      aiHandoff: `Review ${fileName}:${pin.line}, upgrade the pandas dependency to a compatible version >=2 or migrate suitable processing to Polars, and regenerate the existing lockfile. Keep deliberate pandas 1 compatibility jobs. Check Python/NumPy compatibility, dtype and index assertions, null handling, result order, chained assignments, and mutation behavior without weakening tests. Measure fixture setup and test execution separately from dependency installation.`,
      score: 45,
    }),
  ];
  for (const fileName of ["uv.lock", "poetry.lock"]) {
    const filePath = context.scanContext.resolve(fileName);
    if (!(await context.scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await context.scanContext.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }
    const pin = lockPins(text).find(
      (candidate) =>
        /^\d+(?:\.\d+){0,2}$/.test(candidate.spec) && allowsLegacyPandas(candidate.spec),
    );
    if (pin) {
      return build(fileName, pin, true);
    }
  }
  for (const fileName of [
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "requirements-test.txt",
    "dev-requirements.txt",
    "setup.cfg",
    "Pipfile",
  ]) {
    const filePath = context.scanContext.resolve(fileName);
    if (!(await context.scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await context.scanContext.readTextFileOrWarn(filePath);
    const pin = text ? declarationPin(fileName, text) : undefined;
    if (pin) {
      return build(fileName, pin);
    }
  }
  return [];
}
