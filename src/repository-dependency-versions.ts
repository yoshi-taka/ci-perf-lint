import { parse as parseLockfile, type ParsedLockFile } from "lockparse";
import type { RepositoryScanContext } from "./repository-scan-context.ts";
import { packageJsonDependencyVersionSpec } from "./repository-package-helpers.ts";

const lockfileNames = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"] as const;
const cache = new WeakMap<
  RepositoryScanContext,
  Map<string, Promise<ParsedLockFile | undefined>>
>();

async function loadLockfile(context: RepositoryScanContext, fileName: string) {
  let loads = cache.get(context);
  if (!loads) {
    loads = new Map();
    cache.set(context, loads);
  }
  const existing = loads.get(fileName);
  if (existing) {
    return existing;
  }
  const load = (async () => {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      return undefined;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      return undefined;
    }
    const packageJson = (await context.loadPackageJson()).value;
    try {
      // lockparse links Yarn root dependencies through npm: descriptors, including v1.
      const input =
        fileName === "yarn.lock" && text.includes("yarn lockfile v1")
          ? text.replace(
              /^([^\s#][^\n]*):$/gm,
              (_, selectors: string) =>
                `${selectors
                  .split(", ")
                  .map((selector) => selector.replace(/^(["']?@?[^@\s"']+)@(?!npm:)/, "$1@npm:"))
                  .join(", ")}:`,
            )
          : text;
      return await parseLockfile(input, fileName, packageJson);
    } catch {
      return undefined;
    }
  })();
  loads.set(fileName, load);
  return load;
}

export async function readLockedDependencyVersion(
  context: RepositoryScanContext,
  packageName: string,
): Promise<string | undefined> {
  for (const fileName of lockfileNames) {
    const lockfile = await loadLockfile(context, fileName);
    if (!lockfile) {
      continue;
    }
    const root = lockfile.root;
    const dependencies = [
      ...root.devDependencies,
      ...root.dependencies,
      ...root.optionalDependencies,
      ...root.peerDependencies,
    ];
    const dependency = dependencies.find((entry) => entry.name === packageName);
    if (dependency && /^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(dependency.version)) {
      return dependency.version;
    }
  }
  return undefined;
}

/** Resolve the root dependency, never a similarly named transitive package or an unrelated alias. */
export async function effectiveDependencyVersionSpec(
  context: RepositoryScanContext,
  packageName: string,
): Promise<string | undefined> {
  const packageJson = (await context.loadPackageJson()).value;
  if (!packageJson) {
    return undefined;
  }
  const declared = packageJsonDependencyVersionSpec(packageJson, packageName);
  if (!declared) {
    return undefined;
  }
  let spec = declared.trim();
  if (spec.startsWith("npm:")) {
    const alias = /^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(spec);
    if (!alias || alias[1] !== packageName) {
      return undefined;
    }
    spec = alias[2]!;
  }
  if (/^(?:file:|link:|workspace:|https?:|git|github:)/.test(spec)) {
    return undefined;
  }
  const locked = await readLockedDependencyVersion(context, packageName);
  if (locked) {
    const bounds = versionBounds(spec);
    const parts = locked.split("+")[0]!.split(".").map(Number) as [number, number, number];
    if (
      bounds &&
      (compare(parts, bounds.lower) < 0 ||
        (bounds.upper ? compare(parts, bounds.upper) >= 0 : compare(parts, bounds.lower) !== 0))
    ) {
      return undefined;
    }
    return locked;
  }
  // Unsupported ranges/protocols are unknown, not a version extracted from an arbitrary URL.
  return /^(?:[~^=v]?\d+(?:\.\d+){0,2})$/.test(spec) ? spec : undefined;
}

type Version = readonly [number, number, number];
function compare(left: Version, right: Version): number {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i]! - right[i]!;
    }
  }
  return 0;
}

function versionBounds(spec: string): { lower: Version; upper?: Version } | undefined {
  const match = /^([~^=v]?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec.trim());
  if (!match) {
    return undefined;
  }
  const major = Number(match[2]),
    minor = Number(match[3] ?? 0),
    patch = Number(match[4] ?? 0);
  const lower: Version = [major, minor, patch];
  let upper: Version | undefined;
  if (match[1] === "^") {
    upper =
      major > 0 || match[3] === undefined
        ? [major + 1, 0, 0]
        : minor > 0 || match[4] === undefined
          ? [0, minor + 1, 0]
          : [0, 0, patch + 1];
  } else if (match[1] === "~" || match[4] === undefined) {
    upper = match[3] === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
  }
  return { lower, upper };
}

/** true only when every version allowed by a simple range is below the milestone. */
export function versionSpecIsBelow(spec: string, milestone: Version): boolean | undefined {
  const bounds = versionBounds(spec);
  if (!bounds) {
    return undefined;
  }
  if (compare(bounds.lower, milestone) >= 0) {
    return false;
  }
  return bounds.upper ? (compare(bounds.upper, milestone) <= 0 ? true : undefined) : true;
}
