# playwright-route-disables-http-cache

Playwright documents that enabling `page.route()` or `browserContext.route()` disables the HTTP cache. Even a route matching one API endpoint can prevent reuse of unrelated JavaScript, stylesheets, and fonts on subsequent navigations.

## Detection

This repository diagnostic reports route registrations on page/context fixtures from a directly imported `test` in `@playwright/test` or `playwright/test`. It uses AST parsing and lexical bindings, not matching variable names alone. It recognizes test callbacks, lifecycle hooks, inline `test.extend()` fixtures, renamed imports/fixtures, constant aliases, `page.context()`, and `context.newPage()`.

JS/TS files with direct Playwright test imports are scanned, including fixture/helper files. Calls in comments or strings and shadowed/unrelated receivers are ignored. The rule is a high-confidence warning about cache disabling, not proof of a measured slowdown. Each registration is reported at its source location.

Initial limitations: no cross-file custom-test imports, CommonJS imports, browser construction tracing, or type-only helper parameter inference. Reassigned bindings and files with parse errors are skipped conservatively. These can produce false negatives. The rule does not infer browser selection, route lifetime, navigation count, or whether assets were cacheable.

## What to do

Compare repeated navigations in the same context with and without interception. Keep the build, browser, and server conditions identical; measure asset server hits, transferred bytes, and suite time. Fresh contexts do not share a cache, so single-navigation tests may see little benefit.

For API mocks that only need page-level fetch/XHR interception, consider an in-page patch installed before app code with `addInitScript`. It is **not** a drop-in replacement: navigation, workers/service workers, other network APIs, request semantics, and frame behavior need separate review. Keep Playwright routing whenever interception correctness requires it. No automatic fix is provided.

Do not assume that `route.continue()` or a narrow URL matcher preserves the HTTP cache. Do not treat a second CDP session as a supported cache workaround. A hypothetical cache-preserving interception mode would also need to document that renderer memory-cache hits may bypass route handlers.

## References

- [page.route](https://playwright.dev/docs/api/class-page#page-route)
- [browserContext.route](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
- [browserContext.addInitScript](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)
