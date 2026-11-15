import { afterAll, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { collectPlaywrightRouteDisablesHttpCacheDiagnostics } from "../src/repository-diagnostics/playwright-route-disables-http-cache.ts";
import { buildRepositoryFileIndex } from "../src/rules/shared/repository-file-index.ts";
import type { RepositoryDiagnosticContext } from "../src/repository-diagnostics/collector-types.ts";
import {
  prepareShared,
  finishShared,
  getSharedRecord,
} from "../src/repository-diagnostics/source-shared-records.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const dirs = createTempDirTracker();
afterAll(() => dirs.cleanup());
const direct = `import {test} from '@playwright/test';
test('api', async ({page}) => { await page.route('/api', r => r.fulfill({body:'{}'})); });`;
const local = direct.replace(
  "import {test} from '@playwright/test'",
  "import {test} from './fixture'",
);
const fixture = "import {test as base} from '@playwright/test'; export const test=base.extend({});";

function diagnosticContext(scanContext: RepositoryScanContext) {
  return {
    scanContext,
    fileIndex: buildRepositoryFileIndex(scanContext),
    repository: { primaryWorkflowPath: ".github/workflows/ci.yml" },
  } as RepositoryDiagnosticContext;
}
async function setup(files: Record<string, string>) {
  const root = await dirs.create("apl-shared-collectors-");
  await writeRepositoryFiles(root, files);
  return new RepositoryScanContext(root, []);
}
async function evict(context: RepositoryScanContext) {
  const files = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`cache/${i}.txt`, "x"]));
  await writeRepositoryFiles(context.repoRoot, files);
  for (const filename of Object.keys(files)) {
    await context.readTextFileOrWarn(context.resolve(filename));
  }
}

test("shared and legacy collectors retain findings, audit facts, scope and warnings", async () => {
  const cases: Record<string, string>[] = [
    { "e2e/a.spec.ts": direct, "src/plain.ts": "export const x=1;" },
    { "e2e/a.spec.ts": local, "e2e/fixture.ts": fixture },
    {
      "e2e/a.spec.ts": local,
      "e2e/fixture.ts": "export {test} from './base';",
      "e2e/base.ts": fixture,
    },
    { "fixtures/a.spec.ts": direct, "src/broken.ts": "const x=;" },
    { "e2e/a.spec.ts": direct, "assets/vendor.min.js": direct, "dist/ignored.js": direct },
    { "e2e/a.spec.ts": `${direct}\n//${"x".repeat(260 * 1024)}` },
    {
      "e2e/a.spec.ts": direct,
      "src/Component.vue": "<script>import {x} from './entry';</script>",
      "src/entry.ts": "export const x=1;",
    },
    { "src/plain.ts": `//${"漢".repeat(300 * 1024)}` },
  ];
  let positives = 0;
  for (const files of cases) {
    const outputs = [];
    for (const enabled of [false, true]) {
      const context = await setup(files);
      const handle = prepareShared(context, enabled);
      try {
        const audit = await collectSourceAudit(context);
        await evict(context);
        const findings = await collectPlaywrightRouteDisablesHttpCacheDiagnostics(
          diagnosticContext(context),
        );
        outputs.push({ audit, findings, warnings: context.warnings });
        positives += findings.length;
      } finally {
        await finishShared(context, handle);
      }
    }
    expect(outputs[1]).toEqual(outputs[0]);
  }
  expect(positives).toBeGreaterThan(0);
});

test("fixture facts survive text-cache eviction and do not reread a removed fixture", async () => {
  const context = await setup({ "e2e/a.spec.ts": local, "e2e/fixture.ts": fixture });
  const handle = prepareShared(context, true);
  try {
    await collectSourceAudit(context);
    await evict(context);
    await unlink(context.resolve("e2e/fixture.ts"));
    const findings = await collectPlaywrightRouteDisablesHttpCacheDiagnostics(
      diagnosticContext(context),
    );
    expect(findings).toHaveLength(1);
    expect(context.warnings.some((w) => w.message.includes("Failed to read"))).toBe(false);
  } finally {
    await finishShared(context, handle);
  }
});

test("intervening edits use the selected outcome, then appear in a fresh analysis", async () => {
  const context = await setup({ "e2e/a.spec.ts": direct.replace("page.route", "page.xxxxx") });
  const handle = prepareShared(context, true);
  try {
    await collectSourceAudit(context);
    await evict(context);
    await writeRepositoryFiles(context.repoRoot, { "e2e/a.spec.ts": direct });
    expect(
      await collectPlaywrightRouteDisablesHttpCacheDiagnostics(diagnosticContext(context)),
    ).toEqual([]);
  } finally {
    await finishShared(context, handle);
  }
  const fresh = new RepositoryScanContext(context.repoRoot, []);
  const freshHandle = prepareShared(fresh, true);
  try {
    await collectSourceAudit(fresh);
    expect(
      await collectPlaywrightRouteDisablesHttpCacheDiagnostics(diagnosticContext(fresh)),
    ).toHaveLength(1);
  } finally {
    await finishShared(fresh, freshHandle);
  }
});

test("selected read failure remains a failure until the next analysis", async () => {
  const context = await setup({});
  context.walkFilesIter = async function* () {
    yield await Promise.resolve("e2e/a.spec.ts");
  };
  const handle = prepareShared(context, true);
  try {
    await collectSourceAudit(context);
    expect((await getSharedRecord(context, "e2e/a.spec.ts"))?.mode).toBe("read-failed");
    const warnings = [...context.warnings];
    await writeRepositoryFiles(context.repoRoot, { "e2e/a.spec.ts": direct });
    await evict(context);
    expect(
      await collectPlaywrightRouteDisablesHttpCacheDiagnostics(diagnosticContext(context)),
    ).toEqual([]);
    expect(context.warnings).toEqual(warnings);
  } finally {
    await finishShared(context, handle);
  }
});

test("custom context and index readers bypass sharing", async () => {
  const context = await setup({ "e2e/a.spec.ts": local, "e2e/fixture.ts": fixture });
  const handle = prepareShared(context, true);
  try {
    const original = context.readTextFileOrWarn.bind(context);
    context.readTextFileOrWarn = (filename) => original(filename);
    expect(context.usesStandardTextReader()).toBe(false);
    await collectSourceAudit(context);
    expect(getSharedRecord(context, "e2e/fixture.ts")).toBeUndefined();
    expect(
      await collectPlaywrightRouteDisablesHttpCacheDiagnostics(diagnosticContext(context)),
    ).toHaveLength(1);
  } finally {
    await finishShared(context, handle);
  }
  const standard = new RepositoryScanContext(context.repoRoot, []);
  const standardHandle = prepareShared(standard, true);
  try {
    await collectSourceAudit(standard);
    const diagnostic = diagnosticContext(standard);
    let reads = 0;
    const read = diagnostic.fileIndex.readTextFile.bind(diagnostic.fileIndex);
    diagnostic.fileIndex.readTextFile = (filename) => {
      reads++;
      return read(filename);
    };
    expect(diagnostic.fileIndex.usesScanContextTextReader?.()).toBe(false);
    expect(await collectPlaywrightRouteDisablesHttpCacheDiagnostics(diagnostic)).toHaveLength(1);
    expect(reads).toBeGreaterThan(0);
  } finally {
    await finishShared(standard, standardHandle);
  }
});

// Mock the underlying reader only in a child; the real context reader and its
// identity checks remain intact, and unrelated parallel tests keep their reader.
test.each(["concurrent", "cancelled"])("actual shared reader lifecycle: %s", async (mode) => {
  const context = await setup({ "e2e/a.spec.ts": local, "e2e/fixture.ts": fixture });
  const root = new URL("../", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--eval",
      `
    import {mock, expect} from "bun:test";
    const root = ${JSON.stringify(context.repoRoot)};
    const started = Promise.withResolvers(), release = Promise.withResolvers();
    let reads = 0;
    mock.module(${JSON.stringify(new URL("src/read-text-file.ts", root).pathname)}, () => ({
      readTextFile: async filename => {
        if (filename === root + "/e2e/fixture.ts") {
          reads++;
          started.resolve();
          await release.promise;
        }
        return Bun.file(filename).text();
      },
    }));
    const {RepositoryScanContext} = await import(${JSON.stringify(new URL("src/repository-scan-context.ts", root).href)});
    const {collectSourceAudit} = await import(${JSON.stringify(new URL("src/repository-diagnostics/source-audit.ts", root).href)});
    const {prepareShared, finishShared, SharedGenerationCancelled} = await import(${JSON.stringify(new URL("src/repository-diagnostics/source-shared-records.ts", root).href)});
    const {buildRepositoryFileIndex} = await import(${JSON.stringify(new URL("src/rules/shared/repository-file-index.ts", root).href)});
    const {collectPlaywrightRouteDisablesHttpCacheDiagnostics: collect} = await import(${JSON.stringify(new URL("src/repository-diagnostics/playwright-route-disables-http-cache.ts", root).href)});
    const context = new RepositoryScanContext(root, []);
    const handle = prepareShared(context, true);
    const audit = collectSourceAudit(context);
    const outcome = audit.catch(error => error);
    try {
      await started.promise;
      if (${JSON.stringify(mode)} === "cancelled") {
        context.clearCaches();
        release.resolve();
        expect(await outcome).toBeInstanceOf(SharedGenerationCancelled);
      } else {
        const findings = collect({
          scanContext: context, fileIndex: buildRepositoryFileIndex(context),
          repository: {primaryWorkflowPath: ".github/workflows/ci.yml"},
        });
        release.resolve();
        expect(await findings).toHaveLength(1);
        await audit;
        expect(reads).toBe(1);
      }
    } finally {
      release.resolve();
      await outcome;
      await finishShared(context, handle);
    }
  `,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
});
