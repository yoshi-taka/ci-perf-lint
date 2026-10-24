import { describe, expect, test } from "bun:test";
import { findPlaywrightRoutes } from "../src/repository-diagnostics/playwright-route-detector.ts";

const header = `import { test } from '@playwright/test';\n`;
const route = `page.route('**/api/never', r => r.fulfill({ body: '{}' }))`;

describe("Playwright route provenance", () => {
  test.each([
    `test('api', async ({ page }) => { await ${route}; });`,
    `test.beforeEach(async ({ page }) => { await ${route}; });`,
    `test.only('api', async ({ page }) => { await ${route}; });`,
    `test('api', async ({ context }) => { await context.route('**/*', r => r.continue()); });`,
    `test('api', async ({ page: tab }) => { await tab.route('/api', handler); });`,
    `test('api', async ({ page }) => { const tab = page; await tab.route('/api', handler); });`,
    `test('api', async ({ page }) => { await page.context().route('/api', handler); });`,
    `test('api', async ({ context }) => { const page = await context.newPage(); await ${route}; });`,
    `test('api', async ({ page }) => { await page['route']('/api', handler); });`,
    `test('api', async ({ page }) => { await (page as any).route('/api', handler); });`,
    `test('api', async ({ page }) => { await page?.route('/api', handler); });`,
    `const custom = test.extend({ mock: async ({ page }, use) => { await ${route}; await use(null); } });`,
    `const custom = test.extend({}); custom('api', async ({ page }) => { await ${route}; });`,
    `test('api', async ({ page }) => { const install = () => ${route}; install(); });`,
  ])("recognizes %s", (body) => {
    expect(findPlaywrightRoutes("tests/api.spec.ts", header + body)).toHaveLength(1);
  });

  test.each([
    `// ${route}\nconst text = ${JSON.stringify(route)};`,
    `const page = router; ${route};`,
    `test('api', async ({ request }) => { request.route('/api', handler); });`,
    `test('api', async ({ page }) => { page.routeFromHAR('api.har'); page.routeWebSocket('/ws', handler); });`,
    `test('api', async ({ page }) => { function helper(page) { ${route}; } });`,
    `test('api', async ({ page }) => { { const page = router; ${route}; } });`,
    `test('api', async ({ page }) => { { ${route}; const page = router; } });`,
    `test('api', async ({ page }) => { function helper() { ${route}; var page = router; } });`,
    `test('api', async ({ page }) => { try {} catch (page) { ${route}; } });`,
    `test('api', async ({ page }) => { page = router; ${route}; });`,
    `test('api', async ({ page }) => { ({ page } = other); ${route}; });`,
    `test('api', async ({ page }) => { for (page of others) { ${route}; } });`,
    `test('api', async ({ page }) => { for (page in others) { ${route}; } });`,
    `test('api', async function ({ page }) { var page = other; ${route}; });`,
    `test('api', async ({ page }) => { class Helper { constructor(public page: any) { ${route}; } } });`,
    `test('api', async ({ page }) => { const Alias = class page { method() { ${route}; } }; });`,
    `{ const test = other; test('api', async ({ page }) => { ${route}; }); }`,
    `test.describe('api', async ({ page }) => { ${route}; });`,
    `function helper(page: Page) { ${route}; }`,
    `test('api', async ({ page }) => {`,
  ])("ignores %s", (body) => {
    expect(findPlaywrightRoutes("tests/api.spec.ts", header + body)).toEqual([]);
  });

  test("resolves renamed test imports and alternate entrypoint", () => {
    const source = `import { test as e2e } from 'playwright/test'; e2e('api', async ({ page }) => { ${route}; });`;
    expect(findPlaywrightRoutes("api.spec.js", source)).toEqual([source.indexOf(route)]);
  });

  test.each([
    `import { test } from 'vitest';`,
    `import { test } from './fixtures';`,
    `import type { test } from '@playwright/test';`,
    `import { type test } from '@playwright/test';`,
  ])("does not infer Playwright from %s", (importText) => {
    expect(
      findPlaywrightRoutes(
        "api.spec.ts",
        `${importText} test('api', async ({ page }) => { ${route}; });`,
      ),
    ).toEqual([]);
  });

  test("retains outer binding after a shadowing scope", () => {
    const source = `${header}test('api', async ({ page }) => { { const page = other; ${route}; } await ${route}; });`;
    expect(findPlaywrightRoutes("api.spec.ts", source)).toEqual([source.lastIndexOf(route)]);
  });
});
