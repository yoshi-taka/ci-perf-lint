import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { findPlaywrightRoutes } from "./playwright-route-detector.ts";

const meta = {
  id: "playwright-route-disables-http-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/playwright-route-disables-http-cache.md",
} satisfies RuleMeta;

export async function collectPlaywrightRouteDisablesHttpCacheDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const path of (await context.scanContext.walkFiles(".")).sort()) {
    if (
      !/\.(?:[cm]?[jt]sx?)$/.test(path) ||
      /\.d\.[cm]?ts$/.test(path) ||
      /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|\.next)\//.test(path)
    ) {
      continue;
    }
    const source = await context.fileIndex.readTextFile(path);
    // Cheap prefilter avoids parsing repositories without direct Playwright imports.
    if (!source || !source.includes("playwright/test") || !source.includes("route")) {
      continue;
    }
    for (const offset of findPlaywrightRoutes(path, source)) {
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
          why: "Repeated navigations can refetch JavaScript, CSS, and fonts instead of reusing cached assets. Static detection does not establish the actual slowdown.",
          suggestion:
            "Measure repeated navigation cost with and without routing. For fetch/XHR-only API mocks, consider an addInitScript patch after checking interception coverage; retain routing where required for correctness.",
          measurementHint:
            "Compare warm navigations in the same context, asset server hits, and transferred bytes using the same build and browser. Fresh contexts may have no cache reuse to recover.",
          aiHandoff: `Review routing at ${path} without changing test assertions. Benchmark cache reuse before changing mocks. An in-page fetch/XHR patch does not cover navigation, workers, or every network API; do not replace routing automatically.`,
          score: 45,
        }),
      );
    }
  }
  return diagnostics;
}
