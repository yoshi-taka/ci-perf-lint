# playwright-route-disables-http-cache

Playwright documents that enabling `page.route()` or `browserContext.route()` disables the HTTP cache. Even a route matching one API endpoint can prevent reuse of unrelated JavaScript, stylesheets, and fonts on subsequent navigations while routing remains active. This is not necessarily a permanent change for the context.

## Detection

This repository diagnostic reports route registrations on page/context fixtures from a directly imported `test` in `@playwright/test` or `playwright/test`. It uses AST parsing and lexical bindings, not matching variable names alone. It recognizes test callbacks, lifecycle hooks, inline `test.extend()` fixtures, renamed imports/fixtures, constant aliases, `page.context()`, and `context.newPage()`.

JS/TS files with direct Playwright test imports are scanned, including fixture/helper files. Calls in comments or strings and shadowed/unrelated receivers are ignored. The rule is a high-confidence warning about cache disabling, not proof of a measured slowdown. Each registration is reported at its source location.

Initial limitations: no cross-file custom-test imports, CommonJS imports, browser construction tracing, or type-only helper parameter inference. Reassigned bindings and files with parse errors are skipped conservatively. These can produce false negatives. The rule does not infer browser selection, route lifetime, navigation count, or whether assets were cacheable.

An `unroute()` call does not suppress the finding: requests before cleanup can still pay the cache-disabled cost, and a matching cleanup call alone does not prove that every other route was removed. Review the actual route lifetime before acting on the warning.

## What to do

First, remove mocks as soon as they are no longer needed, before subsequent navigations:

```ts
const apiUrl = '**/api/bootstrap';
const mockBootstrap = route => route.fulfill({ json: { ready: true } });
await page.route(apiUrl, mockBootstrap);
await page.goto('/');
// Wait for the app to consume the mock and finish the assertions that need it.
await expect(page.getByText('Ready')).toBeVisible();
await page.unroute(apiUrl, mockBootstrap);
// Later navigations can use the HTTP cache again if no interception remains.
```

Use `context.unroute(url, handler)` for a route registered on the context. Match the original URL/handler and await cleanup; do not remove routes owned by unrelated tests or fixtures. Do not remove a mock if polling or other background requests still depend on it. Removing routes is not a substitute for waiting for in-flight application work to finish.

In Chromium, cache reuse resumes when the last applicable page/context route is removed **and** no HTTP credentials, proxy credentials, or other interception requirement keeps it disabled. Removing a page route is insufficient if a context route remains. Restoring caching does not guarantee that every resource is already cached or cacheable, and registering another route disables it again.

Compare repeated navigations in the same context before registration, during routing, and after awaiting removal of the last route. Keep the build, browser, and server conditions identical; measure asset server hits, transferred bytes, and suite time. Fresh contexts do not share a cache, so single-navigation tests may see little benefit.

A local synthetic measurement with Playwright 1.64.1 / Chromium 156.0.8078.4 on macOS ARM64 confirmed restoration immediately after awaited cleanup: 100 immutable JS/CSS assets generated 100 server hits per navigation with routing and 0 after cleanup. A remaining context route or HTTP credentials prevented restoration. This verifies the mechanism, not a predicted speedup for a real application.

If mocks must remain active and only need page-level fetch/XHR interception, consider an in-page patch installed before app code with `addInitScript`. It is **not** a drop-in replacement: navigation, workers/service workers, other network APIs, request semantics, and frame behavior need separate review. Keep Playwright routing whenever interception correctness requires it. No automatic fix is provided.

Do not assume that `route.continue()` or a narrow URL matcher preserves the HTTP cache. Do not treat a second CDP session as a supported cache workaround. A hypothetical cache-preserving interception mode would also need to document that renderer memory-cache hits may bypass route handlers.

## References

- [page.route](https://playwright.dev/docs/api/class-page#page-route)
- [browserContext.route](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
- [page.unroute](https://playwright.dev/docs/api/class-page#page-unroute)
- [browserContext.unroute](https://playwright.dev/docs/api/class-browsercontext#browser-context-unroute)
- [Chromium interception and cache toggling](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/chromium/crNetworkManager.ts)
- [browserContext.addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)
