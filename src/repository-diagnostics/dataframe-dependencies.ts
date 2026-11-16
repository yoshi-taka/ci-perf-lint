import type { RepositoryDiagnosticContext } from "./collector-types.ts";

type Version = readonly [number, number, number];
type PackageName = "pandas" | "polars";
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
function allowsBelow(spec: string, milestone: Version): boolean {
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
    compare(lower, milestone) < 0
  );
}

function lockPins(text: string, packageName: PackageName): Pin[] {
  const pins: Pin[] = [];
  let inPackage = false;
  let name: string | undefined;
  let version: Pin | undefined;
  const finish = (): void => {
    if (name === packageName) {
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

function declarationPin(
  fileName: string,
  text: string,
  packageName: PackageName,
  milestone: Version,
): Pin | undefined {
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
      const requirement = new RegExp(
        `^${packageName}(?![\\w.-])(?:\\[[\\w, .-]+\\])?\\s*([^#]*)`,
        "i",
      ).exec(line);
      if (requirement) {
        specs = [requirement[1]!.trim()];
      }
    } else if (fileName === "setup.cfg") {
      if (/^\S/.test(raw)) {
        inInstallRequires = section === "options" && /^install_requires\s*=/.test(line);
      }
      if (inInstallRequires) {
        const requirement = new RegExp(
          `^${packageName}(?![\\w.-])(?:\\[[\\w, .-]+\\])?\\s*([^#]*)`,
          "i",
        ).exec(line.replace(/^install_requires\s*=\s*/, ""));
        if (requirement) {
          specs = [requirement[1]!.trim()];
        }
      }
    } else {
      const dependencyTable =
        /^tool\.poetry(?:\.group\.[\w-]+)?\.dependencies$/.test(section) ||
        (fileName === "Pipfile" && ["packages", "dev-packages"].includes(section));
      const key = new RegExp(`^["']?${packageName}["']?\\s*=\\s*(.+)$`).exec(line);
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
        for (const match of line.matchAll(
          new RegExp(`(["'])${packageName}(?![\\w.-])(?:\\[[\\w, .-]+\\])?\\s*(.*?)\\1`, "gi"),
        )) {
          specs.push(match[2]!.trim());
        }
        const structure = line.replace(/"(?:\\.|[^"\\])*"|'[^']*'|#.*$/g, "");
        arrayDepth += (structure.match(/\[/g)?.length ?? 0) - (structure.match(/\]/g)?.length ?? 0);
      }
    }
    const spec = specs.find((candidate) => allowsBelow(candidate, milestone));
    if (spec !== undefined) {
      return { spec, line: index + 1 };
    }
  }
  return undefined;
}

export async function findDataframeDependencyBelow(
  context: RepositoryDiagnosticContext,
  packageName: PackageName,
  milestone: Version,
): Promise<(Pin & { fileName: string; resolved: boolean }) | undefined> {
  for (const fileName of ["uv.lock", "poetry.lock"]) {
    const filePath = context.scanContext.resolve(fileName);
    if (!(await context.scanContext.pathExists(filePath))) {
      continue;
    }
    const text = await context.scanContext.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }
    const pin = lockPins(text, packageName).find(
      (candidate) =>
        /^\d+(?:\.\d+){0,2}$/.test(candidate.spec) && allowsBelow(candidate.spec, milestone),
    );
    if (pin) {
      return { ...pin, fileName, resolved: true };
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
    const pin = text ? declarationPin(fileName, text, packageName, milestone) : undefined;
    if (pin) {
      return { ...pin, fileName, resolved: false };
    }
  }
  return undefined;
}
