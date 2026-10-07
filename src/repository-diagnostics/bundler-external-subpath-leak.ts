import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

// esbuild (including tsup) implicitly externalizes package subpaths. Only exact-ID
// external implementations need this check; their configs must be assessed separately.
const CONFIG_CANDIDATES = ["vite", "rollup", "webpack"].flatMap((tool) =>
  ["js", "ts", "mjs", "cjs"].map((ext) => `${tool}.config.${ext}`),
);

const meta = {
  id: "bundler-external-subpath-leak",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/bundler-external-subpath-leak.md",
} satisfies RuleMeta;

function literalExternals(text: string, webpack: boolean): Set<string> | undefined {
  const name = webpack ? "externals" : "external";
  const arrays = [...text.matchAll(new RegExp(`\\b${name}\\s*:\\s*\\[([^\\]]*)\\]`, "g"))];
  const objects = webpack ? [...text.matchAll(/\bexternals\s*:\s*\{([^}]*)\}/g)] : [];
  if (arrays.length === 0 && objects.length === 0) {
    return undefined;
  }
  const entries = new Set<string>();
  for (const array of arrays) {
    const body = array[1] ?? "";
    const strings = [...body.matchAll(/(["'])([^"']+)\1/g)];
    // Predicates, RegExp, spreads and computed entries cannot be proven by this scanner.
    if (body.replace(/(["'])([^"']+)\1/g, "").replace(/[\s,]/g, "")) {
      return undefined;
    }
    for (const match of strings) {
      entries.add(match[2]!);
    }
  }
  for (const object of objects) {
    const body = object[1] ?? "";
    const pair = /(?:"([^"\\]+)"|'([^'\\]+)'|([A-Za-z_$][\w$]*))\s*:\s*(?:"[^"\\]*"|'[^'\\]*')/g;
    if (body.replace(pair, "").replace(/[\s,]/g, "")) {
      return undefined;
    }
    for (const match of body.matchAll(pair)) {
      entries.add(match[1] ?? match[2] ?? match[3]!);
    }
  }
  return entries;
}

function packageName(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0]!;
}

export async function collectBundlerExternalSubpathLeakDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { scanContext, repository } = context;
  const pkg = (await scanContext.loadPackageJson()).value;
  if (!pkg) {
    return [];
  }
  const deps = new Set<string>();
  for (const section of ["dependencies", "peerDependencies", "devDependencies"]) {
    const value = pkg[section];
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        deps.add(key);
      }
    }
  }
  const configs: { file: string; entries: Set<string> }[] = [];
  for (const file of CONFIG_CANDIDATES) {
    if (!(await scanContext.pathExists(scanContext.resolve(file)))) {
      continue;
    }
    const text = await scanContext.readTextFileOrWarn(scanContext.resolve(file));
    const entries = text ? literalExternals(text, file.startsWith("webpack")) : undefined;
    if (entries) {
      configs.push({ file, entries });
    }
  }
  if (configs.length === 0) {
    return [];
  }
  const imports = new Map<string, Set<string>>();
  for (const file of await scanContext.walkFiles(".", {
    include: (candidate) => /\.[cm]?[jt]sx?$/.test(candidate) && !candidate.startsWith("."),
  })) {
    const text = await scanContext.readTextFileOrWarn(scanContext.resolve(file));
    for (const match of (text ?? "").matchAll(
      /\bfrom\s*["']([^"']+)["']|\b(?:require|import)\s*\(\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[1] ?? match[2]!;
      const base = packageName(specifier);
      if (base === specifier || !deps.has(base)) {
        continue;
      }
      const paths = imports.get(base) ?? new Set<string>();
      paths.add(specifier);
      imports.set(base, paths);
    }
  }
  const findings: Diagnostic[] = [];
  for (const config of configs) {
    for (const [pkgName, paths] of imports) {
      if (!config.entries.has(pkgName)) {
        continue;
      }
      const uncovered = [...paths].filter((specifier) => !config.entries.has(specifier)).sort();
      if (uncovered.length === 0) {
        continue;
      }
      const examples = uncovered
        .slice(0, 3)
        .map((specifier) => `"${specifier}"`)
        .join(", ");
      findings.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: config.file, line: 1, column: 1 },
          message: `External config in ${config.file} matches only package root "${pkgName}", but this project imports uncovered subpath exports such as ${examples}.`,
          why: "Rollup/Vite and webpack literal external entries match exact module IDs. A package-root string does not cover other imported subpaths, which may add dependency code to build artifacts.",
          suggestion:
            "Add explicit imported subpath entries or use the bundler's supported RegExp/predicate external API. Do not use glob strings with exact-ID external implementations.",
          measurementHint:
            "Inspect the bundler's module graph and compare bundle size before and after adding subpath coverage.",
          aiHandoff: `Review ${config.file} for "${pkgName}" and cover ${examples} using the bundler's supported external API. Preserve intentional bundled subpaths.`,
          score: 60,
        }),
      );
    }
  }
  return findings;
}
