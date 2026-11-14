import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { buildRepositoryFileIndex } from "../src/rules/shared/repository-file-index.ts";
import { collectPlaywrightRouteDisablesHttpCacheDiagnostics } from "../src/repository-diagnostics/playwright-route-disables-http-cache.ts";
import type { RepositoryDiagnosticContext } from "../src/repository-diagnostics/collector-types.ts";

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

  test("follows a local test fixture module", async () => {
    const findings = await scan({
      "e2e/pageTest.ts": `import { test as base } from '@playwright/test';
export const test = base.extend({});`,
      "e2e/api.spec.ts": `import { test as it } from './pageTest';
it('api', async ({ page }) => { await page.route('**/api', r => r.fulfill({ body: '{}' })); });`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.location.path).toBe("e2e/api.spec.ts");
  });

  test("follows a transitive local fixture module", async () => {
    const findings = await scan({
      "e2e/baseTest.ts": `import { test } from '@playwright/test';
export const baseTest = test.extend({});`,
      "e2e/pageTest.ts": `import { baseTest } from './baseTest';
export const test = baseTest;`,
      "e2e/api.spec.ts": `import { test as it } from './pageTest';
it('api', async ({ page }) => { await page.route('**/api', r => r.fulfill({ body: '{}' })); });`,
    });
    expect(findings).toHaveLength(1);
  });

  test("skips generated bundles and oversized sources", async () => {
    const routeSource = `import { test } from '@playwright/test';
test('api', async ({ page }) => { await page.route('/api', r => r.fulfill({ body: '{}' })); });`;
    const findings = await scan({
      ".yarn/releases/yarn-4.10.3.cjs": routeSource,
      "assets/vendor.min.js": routeSource,
      "e2e/oversized.spec.ts": `${routeSource}\n// ${"x".repeat(260 * 1024)}`,
      "e2e/kept.spec.ts": routeSource,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.location.path).toBe("e2e/kept.spec.ts");
  });

  test("rejects certainly oversized bundles before loading their text", async () => {
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const original = RepositoryScanContext.prototype.readTextFileOrWarn;
    const loaded: string[] = [];
    const reader = spyOn(RepositoryScanContext.prototype, "readTextFileOrWarn").mockImplementation(
      function (this: RepositoryScanContext, path: string) {
        loaded.push(path);
        return original.call(this, path);
      },
    );
    try {
      const findings = await scan({
        "generated.js.snapshot/bundle.js": `// ${"x".repeat(4 * 256 * 1024)}`,
      });
      expect(findings).toEqual([]);
      expect(loaded.some((path) => path.endsWith("/generated.js.snapshot/bundle.js"))).toBe(false);
    } finally {
      reader.mockRestore();
    }
  });

  test.each(["x", "漢", "😀"])(
    "keeps the UTF-16 limit for %s padding, not a smaller byte limit",
    async (character) => {
      const routeSource = `import { test } from '@playwright/test';
test('api', async ({ page }) => { await page.route('/api', r => r.fulfill({ body: '{}' })); });
// `;
      const remaining = 256 * 1024 - routeSource.length;
      const source =
        routeSource +
        character.repeat(Math.floor(remaining / character.length)) +
        "x".repeat(remaining % character.length);
      expect(source.length).toBe(256 * 1024);
      const findings = await scan({
        "e2e/exact.spec.ts": source,
        "e2e/over.spec.ts": `${source}x`,
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.location.path).toBe("e2e/exact.spec.ts");
    },
  );

  test("prefetches only two reads and preserves findings when later reads finish first", async () => {
    const names = ["a", "b", "c", "d"];
    const gates = names.map(() => Promise.withResolvers<void>());
    const secondStarted = Promise.withResolvers<void>();
    const fourthStarted = Promise.withResolvers<void>();
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    // oxlint-disable-next-line typescript/unbound-method -- Called with the original receiver below.
    const original = RepositoryScanContext.prototype.readTextFileOrWarn;
    const reader = spyOn(RepositoryScanContext.prototype, "readTextFileOrWarn").mockImplementation(
      async function (this: RepositoryScanContext, path: string) {
        const index = names.findIndex((name) => path.endsWith(`/e2e/${name}.spec.ts`));
        if (index < 0) {
          return original.call(this, path);
        }
        started.push(names[index]!);
        active++;
        peak = Math.max(peak, active);
        if (started.length === 2) {
          secondStarted.resolve();
        }
        if (started.length === 4) {
          fourthStarted.resolve();
        }
        try {
          await gates[index]!.promise;
          return await original.call(this, path);
        } finally {
          active--;
        }
      },
    );
    const running = scan(
      Object.fromEntries(
        names.map((name) => [
          `e2e/${name}.spec.ts`,
          `import { test } from '@playwright/test';
test('${name}', async ({ page }) => { await page.route('/${name}', r => r.fulfill({ body: '{}' })); });`,
        ]),
      ),
    );
    try {
      await secondStarted.promise;
      expect(started.toSorted()).toEqual(["a", "b"]);
      gates[1]!.resolve();
      // a is still pending: the producer must not run ahead through c/d.
      expect(started.toSorted()).toEqual(["a", "b"]);
      gates[0]!.resolve();
      await fourthStarted.promise;
      expect(started.toSorted()).toEqual(names);
      expect(peak).toBe(2);
      gates[3]!.resolve();
      gates[2]!.resolve();
      const findings = await running;
      expect(findings.map((finding) => finding.location.path)).toEqual(
        names.map((name) => `e2e/${name}.spec.ts`),
      );
      expect(active).toBe(0);
    } finally {
      for (const gate of gates) {
        gate.resolve();
      }
      await running;
      reader.mockRestore();
    }
  });

  test("drains pending reads before returning a failure, without late warning mutations", async () => {
    const cwd = await tempDirs.create("apl-playwright-prefetch-failure-");
    await writeRepositoryFiles(cwd, { "a.ts": "", "b.ts": "", "c.ts": "" });
    const context = new RepositoryScanContext(cwd, []);
    const first = Promise.withResolvers<string | undefined>();
    const second = Promise.withResolvers<string | undefined>();
    const secondStarted = Promise.withResolvers<void>();
    const started: string[] = [];
    const events: string[] = [];
    const fileIndex = buildRepositoryFileIndex(context);
    fileIndex.readTextFile = async (path) => {
      started.push(path);
      if (started.length === 2) {
        secondStarted.resolve();
      }
      if (path === "a.ts") {
        return first.promise;
      }
      try {
        return await second.promise;
      } finally {
        context.warn("prefetch-test", "Read finished");
        events.push("read-finished");
      }
    };
    const failure = new Error("Read failed");
    let returned = false;
    const running = collectPlaywrightRouteDisablesHttpCacheDiagnostics({
      scanContext: context,
      fileIndex,
    } as RepositoryDiagnosticContext).then(
      () => {
        throw new Error("Expected read failure");
      },
      (error: unknown) => {
        returned = true;
        events.push("returned");
        return error;
      },
    );
    try {
      await secondStarted.promise;
      first.reject(failure);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(returned).toBe(false);
      second.resolve(undefined);
      expect(await running).toBe(failure);
      expect(started.toSorted()).toEqual(["a.ts", "b.ts"]);
      expect(events).toEqual(["read-finished", "returned"]);
      const warnings = [...context.warnings];
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(context.warnings).toEqual(warnings);
      expect(warnings).toHaveLength(1);
    } finally {
      first.reject(failure);
      second.resolve(undefined);
      await running;
    }
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
