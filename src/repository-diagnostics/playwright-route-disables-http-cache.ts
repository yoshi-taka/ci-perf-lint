import nodePath from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findPlaywrightRoutes, playwrightModuleFacts } from "./playwright-route-detector.ts";

const meta = {
  id: "playwright-route-disables-http-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/playwright-route-disables-http-cache.md",
} satisfies RuleMeta;

const sourceSuffixes = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

export async function collectPlaywrightRouteDisablesHttpCacheDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const files = (await context.scanContext.walkFiles(".")).sort();
  const fileSet = new Set(files);
  const sourceCache = new Map<string, string | undefined>();

  async function read(path: string): Promise<string | undefined> {
    if (!sourceCache.has(path)) {
      sourceCache.set(path, await context.fileIndex.readTextFile(path));
    }
    return sourceCache.get(path);
  }

  function resolveLocalImport(fromPath: string, specifier: string): string | undefined {
    if (!specifier.startsWith(".")) {
      return undefined;
    }
    const base = nodePath.posix.normalize(
      nodePath.posix.join(nodePath.posix.dirname(fromPath), specifier),
    );
    const candidates: string[] = [];
    for (const suffix of sourceSuffixes) {
      candidates.push(base + suffix);
    }
    // TypeScript ESM commonly writes './module.js' for a './module.ts' source.
    const replaced = base.replace(/\.(?:m?js|jsx|cjs)$/, (extension) => {
      switch (extension) {
        case ".js":
          return ".ts";
        case ".jsx":
          return ".tsx";
        case ".mjs":
          return ".mts";
        case ".cjs":
          return ".cts";
        default:
          return extension;
      }
    });
    if (replaced !== base) {
      for (const suffix of sourceSuffixes) {
        candidates.push(replaced + suffix);
      }
    }
    for (const suffix of sourceSuffixes) {
      candidates.push(nodePath.posix.join(base, `index${suffix}`));
    }
    return candidates.find((candidate) => fileSet.has(candidate));
  }

  const fixtureCache = new Map<string, boolean>();

  async function isFixtureModule(
    modulePath: string,
    requireTestExport: boolean,
    seen = new Set<string>(),
  ): Promise<boolean> {
    const cacheKey = `${requireTestExport ? "test" : "dependency"}:${modulePath}`;
    const cached = fixtureCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    if (seen.has(modulePath)) {
      return false;
    }
    const source = await read(modulePath);
    if (!source) {
      fixtureCache.set(cacheKey, false);
      return false;
    }
    const facts = playwrightModuleFacts(modulePath, source);
    if (!facts || (requireTestExport && !facts.exportsTest)) {
      fixtureCache.set(cacheKey, false);
      return false;
    }
    if (facts.importsPlaywrightTest) {
      fixtureCache.set(cacheKey, true);
      return true;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(modulePath);
    for (const specifier of facts.localImports) {
      const target = resolveLocalImport(modulePath, specifier);
      if (target && (await isFixtureModule(target, false, nextSeen))) {
        fixtureCache.set(cacheKey, true);
        return true;
      }
    }
    fixtureCache.set(cacheKey, false);
    return false;
  }

  for (const path of files) {
    if (
      !/\.(?:[cm]?[jt]sx?)$/.test(path) ||
      /\.d\.[cm]?ts$/.test(path) ||
      /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next)\//.test(path)
    ) {
      continue;
    }
    const source = await read(path);
    if (!source || !source.includes("route")) {
      continue;
    }
    const facts = playwrightModuleFacts(path, source);
    if (!facts) {
      continue;
    }
    const localFixtureSpecs = new Set<string>();
    for (const specifier of facts.localTestImports) {
      const target = resolveLocalImport(path, specifier);
      if (target && (await isFixtureModule(target, true))) {
        localFixtureSpecs.add(specifier);
      }
    }
    if (!source.includes("playwright/test") && localFixtureSpecs.size === 0) {
      continue;
    }
    for (const offset of findPlaywrightRoutes(path, source, localFixtureSpecs)) {
      const before = source.slice(0, offset);
      diagnostics.push(
        buildRepositoryDiagnostic(context.repository, meta, {
          location: {
            path,
            line: before.split("\n").length,
            column: offset - before.lastIndexOf("\n"),
          },
          message:
            "Playwright route registration disables the browser HTTP cache, even for a narrow API URL pattern.",
          why: "While routing is active, repeated navigations can refetch JavaScript, CSS, and fonts instead of reusing cached assets. Static detection does not establish the route lifetime or actual slowdown.",
          suggestion:
            "First, await page.unroute() or context.unroute() with the matching URL/handler as soon as the mocks are no longer needed. In Chromium, HTTP cache reuse resumes when the last page/context route is removed and no HTTP/proxy authentication keeps interception active. If mocks must remain active, consider an addInitScript fetch/XHR patch only after checking interception coverage; retain routing where required for correctness.",
          measurementHint:
            "Compare warm navigations in the same context before routing, during routing, and after awaiting removal of the last route. Measure asset server hits and transferred bytes using the same build and browser. Check remaining page/context routes and HTTP/proxy authentication if cache reuse does not resume. Fresh contexts may have no cache reuse to recover.",
          aiHandoff: `Review routing at ${path} without changing test assertions. First identify when each mock is no longer needed and await unroute with its matching URL/handler before subsequent navigations; do not remove mocks still required by background requests or unrelated routes. Benchmark cache reuse and check remaining page/context routes and HTTP/proxy authentication. Only consider an addInitScript fetch/XHR patch if early cleanup is insufficient; it does not cover navigation, workers, or every network API. Do not replace routing automatically.`,
          score: 45,
        }),
      );
    }
  }
  return diagnostics;
}
