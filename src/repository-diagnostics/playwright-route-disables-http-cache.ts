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
