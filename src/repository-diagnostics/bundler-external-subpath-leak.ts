import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const CONFIG_CANDIDATES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "rollup.config.js",
  "rollup.config.ts",
  "rollup.config.mjs",
  "rollup.config.cjs",
  "tsup.config.js",
  "tsup.config.ts",
  "tsup.config.mjs",
  "tsup.config.cjs",
  "esbuild.config.js",
  "esbuild.config.ts",
  "esbuild.config.mjs",
  "esbuild.config.cjs",
  "webpack.config.js",
  "webpack.config.ts",
  "webpack.config.mjs",
  "webpack.config.cjs",
] as const;

const meta = {
  id: "bundler-external-subpath-leak",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/bundler-external-subpath-leak.md",
} satisfies RuleMeta;

function extractStringEntries(text: string): string[] {
  const entries: string[] = [];
  const re = /"([^"]+)"|'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    entries.push(m[1] ?? m[2] ?? "");
  }
  return entries;
}

function extractExternalArrayPackages(text: string): {
  rootOnly: string[];
  wildcardPackages: Set<string>;
} {
  const rootOnly: string[] = [];
  const wildcardPackages = new Set<string>();

  const arrays = text.matchAll(/external:\s*\[([\s\S]*?)\]/g);
  for (const arrayMatch of arrays) {
    const arrayContent = arrayMatch[1] ?? "";
    const entries = extractStringEntries(arrayContent);
    for (const entry of entries) {
      if (!entry) {
        continue;
      }
      if (entry.includes("*")) {
        const starIdx = entry.indexOf("*");
        const pkg = starIdx > 0 ? entry.slice(0, entry.lastIndexOf("/", starIdx)) : entry;
        if (pkg) {
          wildcardPackages.add(pkg);
        }
      } else if (entry.includes("/")) {
        const pkg = entry.startsWith("@")
          ? entry.split("/").slice(0, 2).join("/")
          : (entry.split("/")[0] ?? entry);
        if (pkg && pkg !== entry) {
          wildcardPackages.add(pkg);
        }
      } else {
        rootOnly.push(entry);
      }
    }
  }

  return { rootOnly, wildcardPackages };
}

function extractWebpackExternalsPackages(text: string): {
  rootOnly: string[];
  wildcardPackages: Set<string>;
} {
  const rootOnly: string[] = [];
  const wildcardPackages = new Set<string>();

  const objMatches = text.matchAll(/externals:\s*\{(.*?)\}/gs);
  for (const objMatch of objMatches) {
    const objContent = objMatch[1] ?? "";
    const keyMatches = objContent.matchAll(/"([^"]+)"|'([^']+)'\s*:/g);
    for (const keyMatch of keyMatches) {
      const key = keyMatch[1] ?? keyMatch[2] ?? "";
      if (!key) {
        continue;
      }
      if (key.includes("*")) {
        const starIdx = key.indexOf("*");
        const pkg = starIdx > 0 ? key.slice(0, key.lastIndexOf("/", starIdx)) : key;
        if (pkg) {
          wildcardPackages.add(pkg);
        }
      } else if (key.includes("/")) {
        rootOnly.push(key.split("/")[0] ?? key);
      } else {
        rootOnly.push(key);
      }
    }
  }

  const arrayMatches = text.matchAll(/externals:\s*\[([\s\S]*?)\]/g);
  for (const arrayMatch of arrayMatches) {
    const entries = extractStringEntries(arrayMatch[1] ?? "");
    for (const entry of entries) {
      if (!entry) {
        continue;
      }
      if (entry.includes("*")) {
        const starIdx = entry.indexOf("*");
        const pkg = starIdx > 0 ? entry.slice(0, entry.lastIndexOf("/", starIdx)) : entry;
        if (pkg) {
          wildcardPackages.add(pkg);
        }
      } else if (entry.includes("/")) {
        rootOnly.push(entry.split("/")[0] ?? entry);
      } else {
        rootOnly.push(entry);
      }
    }
  }

  return { rootOnly, wildcardPackages };
}

function usesFunctionLikeExternal(text: string): boolean {
  return /external\s*:\s*(?:\([^)]*\)\s*=|function\s*\()/.test(text);
}

function extractEsbuildCliExternals(text: string): {
  rootOnly: string[];
  wildcardPackages: Set<string>;
} {
  const rootOnly: string[] = [];
  const wildcardPackages = new Set<string>();
  const re = /--external:([a-z@][^\s"'|&;=]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const pkg = m[1]?.trim();
    if (!pkg) {
      continue;
    }
    if (pkg.includes("*")) {
      const starIdx = pkg.indexOf("*");
      const base = starIdx > 0 ? pkg.slice(0, pkg.lastIndexOf("/", starIdx)) : pkg;
      if (base) {
        wildcardPackages.add(base);
      }
    } else if (pkg.includes("/")) {
      const base = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0]!;
      if (base) {
        wildcardPackages.add(base);
      }
    } else {
      rootOnly.push(pkg);
    }
  }
  return { rootOnly, wildcardPackages };
}

function extractSourceImports(text: string): string[] {
  const specifiers: string[] = [];

  const fromRe = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(text)) !== null) {
    specifiers.push(m[1] ?? "");
  }

  const requireRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = requireRe.exec(text)) !== null) {
    specifiers.push(m[1] ?? "");
  }

  const dynamicImportRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynamicImportRe.exec(text)) !== null) {
    specifiers.push(m[1] ?? "");
  }

  return specifiers;
}

function isSubpathImport(specifier: string, pkgName: string): boolean {
  if (specifier === pkgName) {
    return false;
  }
  if (specifier.startsWith(`${pkgName}/`)) {
    return true;
  }
  return false;
}

function basePackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export async function collectBundlerExternalSubpathLeakDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const { scanContext, repository } = context;

  const pkgEntry = await scanContext.loadPackageJson();
  const pkgVal = pkgEntry.value;
  if (!pkgVal) {
    return [];
  }

  const allDeps = new Set<string>();
  for (const section of ["dependencies", "peerDependencies", "devDependencies"] as const) {
    const deps = pkgVal[section];
    if (typeof deps === "object" && deps !== null) {
      for (const key of Object.keys(deps as Record<string, unknown>)) {
        if (!key.startsWith("@types/")) {
          allDeps.add(key);
        }
      }
    }
  }

  if (allDeps.size === 0) {
    return [];
  }

  const pkgText = pkgEntry.text ?? "";
  const cliExternals = extractEsbuildCliExternals(pkgText);

  let bundlerConfigFound = false;
  let hasFunctionConfig = false;
  const rootOnlyByConfig = new Map<string, Set<string>>();
  const wildcardClustersByConfig = new Map<string, Set<string>>();

  const configCheckResults = await Promise.all(
    CONFIG_CANDIDATES.map(async (fileName) => {
      const filePath = scanContext.resolve(fileName);
      const exists = await scanContext.pathExists(filePath);
      if (!exists) {
        return undefined;
      }
      const content = await scanContext.readTextFileOrWarn(filePath);
      if (!content) {
        return undefined;
      }
      return { fileName, content };
    }),
  );

  for (const result of configCheckResults) {
    if (!result) {
      continue;
    }
    const { fileName, content } = result;
    bundlerConfigFound = true;

    if (usesFunctionLikeExternal(content)) {
      hasFunctionConfig = true;
      continue;
    }

    const isWebpack = fileName.startsWith("webpack.config.");
    let configRootOnly: string[];
    let configWildcard: Set<string>;

    if (isWebpack) {
      const wp = extractWebpackExternalsPackages(content);
      configRootOnly = wp.rootOnly;
      configWildcard = wp.wildcardPackages;
    } else {
      const cfg = extractExternalArrayPackages(content);
      configRootOnly = cfg.rootOnly;
      configWildcard = cfg.wildcardPackages;
    }

    rootOnlyByConfig.set(fileName, new Set(configRootOnly.filter((p) => allDeps.has(p))));
    wildcardClustersByConfig.set(fileName, configWildcard);
  }

  let allRootOnly = new Set(rootOnlyByConfig.values().flatMap((s) => [...s]));
  for (const pkgName of cliExternals.rootOnly) {
    if (allDeps.has(pkgName)) {
      allRootOnly.add(pkgName);
    }
  }

  if (
    !bundlerConfigFound &&
    cliExternals.rootOnly.length === 0 &&
    cliExternals.wildcardPackages.size === 0
  ) {
    return [];
  }
  if (hasFunctionConfig) {
    return [];
  }
  if (allRootOnly.size === 0) {
    return [];
  }

  const allWildcardPackages = new Set<string>();
  for (const pkgs of wildcardClustersByConfig.values()) {
    for (const pkg of pkgs) {
      allWildcardPackages.add(pkg);
    }
  }
  for (const pkg of cliExternals.wildcardPackages) {
    allWildcardPackages.add(pkg);
  }

  const sourceFiles = await scanContext.walkFiles(".", {
    include: (relativePath: string) => {
      const ext = relativePath.slice(relativePath.lastIndexOf("."));
      return SOURCE_EXTENSIONS.has(ext) && !relativePath.startsWith(".");
    },
  });

  const subpathImportsByPkg = new Map<string, Set<string>>();
  for (const filePath of sourceFiles) {
    const resolvedPath = scanContext.resolve(filePath);
    const content = await scanContext.readTextFileOrWarn(resolvedPath);
    if (!content) {
      continue;
    }
    const specifiers = extractSourceImports(content);
    for (const specifier of specifiers) {
      const base = basePackageName(specifier);
      if (!allDeps.has(base)) {
        continue;
      }
      if (!isSubpathImport(specifier, base)) {
        continue;
      }
      const existing = subpathImportsByPkg.get(base) ?? new Set();
      existing.add(specifier);
      subpathImportsByPkg.set(base, existing);
    }
  }

  const diagnostics: Diagnostic[] = [];

  for (const [pkgName, subpaths] of subpathImportsByPkg) {
    if (subpaths.size === 0) {
      continue;
    }
    if (!allRootOnly.has(pkgName)) {
      continue;
    }

    if (allWildcardPackages.has(pkgName)) {
      continue;
    }

    const configsForPkg: string[] = [];
    for (const [fileName, pkgs] of rootOnlyByConfig) {
      if (pkgs.has(pkgName)) {
        configsForPkg.push(fileName);
      }
    }

    if (cliExternals.rootOnly.includes(pkgName)) {
      configsForPkg.push("package.json (scripts)");
    }

    if (configsForPkg.length === 0) {
      continue;
    }

    const configNames = configsForPkg;
    const sortedSubpaths = [...subpaths].sort();
    const examples = sortedSubpaths.slice(0, 3);
    const exampleStr = examples.map((s) => `"${s}"`).join(", ");
    const more = sortedSubpaths.length > 3 ? ` and ${sortedSubpaths.length - 3} more` : "";

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: configNames[0] ?? ".github/workflows/ci.yml",
          line: 1,
          column: 1,
        },
        message: `External config in ${configNames.join(", ")} matches only package root "${pkgName}", but this project imports subpath exports such as ${exampleStr}${more}. These subpath imports may still be bundled, causing unexpected dependency inclusion, larger artifacts, and additional build or deploy work.`,
        why: 'Most bundlers treat external entries as exact module IDs. A root-only entry like `external: ["react"]` does not cover subpath imports like `react/jsx-runtime`. This can cause unexpected bundling of dependency subpaths, increasing bundle size, sourcemaps, and transfer costs.',
        suggestion: `Add subpath entries or a wildcard pattern for "${pkgName}" to the external config. Use a function like \`id => id === "${pkgName}" || id.startsWith("${pkgName}/")\` or add explicit entries for the imported subpaths.`,
        measurementHint:
          "Compare bundle size and module resolution output before and after adding subpath coverage. Tools like `vite build --stats` or `esbuild --metafile` can surface whether subpath modules still appear in the bundle.",
        aiHandoff: `Review the bundler external configuration in ${configNames.join(", ")} for package "${pkgName}". The project imports subpath exports ${exampleStr}${more} which may not be covered by root-only external entries. Add subpath or wildcard entries or switch to a predicate-based external function.`,
        score: 60,
      }),
    );
  }

  return diagnostics;
}
