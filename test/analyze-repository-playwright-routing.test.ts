import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rule = { id: "playwright-route-disables-http-cache", severity: "warning" } as const;

async function scan(files: Record<string, string>) {
  const cwd = await tempDirs.create("apl-playwright-route-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({ devDependencies: { "@playwright/test": "^1.50.0" } }),
    ".github/workflows/ci.yml":
      "on: push\njobs:\n  e2e:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx playwright test\n",
    ...files,
  });
  const report = await analyzeRepositoryForRule({ cwd, targetPath: ".", topCount: 100 }, rule);
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("Playwright routing HTTP cache diagnostic", () => {
  test("reports narrow API mocks and catch-all routing in strict mode at exact locations", async () => {
    const findings = await scan({
      "e2e/api.spec.ts": `import { test } from '@playwright/test';
test('api', async ({ page, context }) => {
  await page.route('**/api/never', r => r.fulfill({ body: '{}' }));
  await context.route('**/*', r => r.continue());
});`,
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.location)).toEqual([
      { path: "e2e/api.spec.ts", line: 3, column: 9 },
      { path: "e2e/api.spec.ts", line: 4, column: 9 },
    ]);
    expect(findings[0]).toMatchObject({
      severity: "warning",
      confidence: "high",
      docsPath: `docs/rules/${rule.id}.md`,
      scope: "repository",
    });
    expect(findings[0]!.suggestion).toContain("addInitScript");
    expect(findings[0]!.suggestion).toContain("await page.unroute()");
    expect(findings[0]!.suggestion).toContain("context.unroute()");
    expect(findings[0]!.suggestion.indexOf("unroute")).toBeLessThan(
      findings[0]!.suggestion.indexOf("addInitScript"),
    );
    expect(findings[0]!.suggestion).toContain("last page/context route");
    expect(findings[0]!.suggestion).toContain("HTTP/proxy authentication");
    expect(findings[0]!.measurementHint).toContain("same context");
    expect(findings[0]!.measurementHint).toContain("after awaiting removal of the last route");
    expect(findings[0]!.aiHandoff).toContain("background requests");
  });

  test("keeps a route finding after cleanup because its active lifetime is not inferred", async () => {
    const findings = await scan({
      "e2e/cleanup.spec.ts": `import { test } from '@playwright/test';
test('api', async ({ page, context }) => {
  const handler = r => r.fulfill({ json: { ready: true } });
  await context.route('**/api/bootstrap', handler);
  await page.goto('/');
  await context.unroute('**/api/bootstrap', handler);
  await page.goto('/next');
});`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.why).toContain("While routing is active");
    expect(findings[0]!.why).toContain("route lifetime");
  });

  test("includes inline fixtures in helper files but excludes generated assets", async () => {
    const fixture = `import { test as base } from '@playwright/test';
export const test = base.extend({ mock: async ({ page }, use) => {
  await page.route('/api', r => r.fulfill({ body: '{}' }));
  await use(null);
} });`;
    const findings = await scan({
      "support/fixtures.ts": fixture,
      "dist/fixtures.js": fixture,
      "vendor/fixtures.js": fixture,
      "types.d.ts": fixture,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.location.path).toBe("support/fixtures.ts");
  });

  test("does not warn for fetch patches, unrelated routes, comments, or custom cross-file imports", async () => {
    const findings = await scan({
      "e2e/api.spec.ts": `import { test } from '@playwright/test';
test('api', async ({ page }) => {
  // page.route('/api', handler);
  const example = "page.route('/api', handler)";
  await page.addInitScript(() => { window.fetch = mockFetch; });
  const router = otherRouter;
  router.route('/api', handler);
});`,
      "e2e/custom.spec.ts": `import { test } from './fixtures'; test('api', async ({ page }) => { page.route('/api', handler); });`,
      "e2e/broken.spec.ts": `import { test } from '@playwright/test'; test('api', async ({ page }) => {`,
    });
    expect(findings).toEqual([]);
  });
});
