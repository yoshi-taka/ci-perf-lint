import { testTempRoot } from "./temp-root.ts";
import { describe, expect, test } from "bun:test";
import { mkdtemp, cp, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { collectLargeJestSnapshotDiagnostics } from "../src/repository-diagnostics/jest-snapshot.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { writeRepositoryFiles } from "./helpers.ts";

const repoRoot = path.resolve(import.meta.dir, "..");
let cliBuilt = false;
function ensureCliBuilt() {
  if (cliBuilt) {
    return;
  }
  const result = spawnSync("bun", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`CLI build failed: ${result.stderr}`);
  }
  cliBuilt = true;
}
async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(testTempRoot(), "apl-source-e2e-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("native source audit e2e", () => {
  test.each([
    ["date-fns-root-import-like", "prefer-direct-date-fns-imports"],
    ["barrel-file-like", "detected-large-barrel-file"],
  ])("detects %s via Node without an Oxlint runtime dependency", async (fixture, ruleId) => {
    ensureCliBuilt();
    await withTempDir(async (dir) => {
      const target = path.join(dir, "fixture");
      await cp(path.join(repoRoot, "test/fixtures", fixture), target, { recursive: true });
      const result = spawnSync(
        "node",
        [path.join(repoRoot, "dist/cli.js"), "--findings-only", target, "--format", "json"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, CI_PERF_LINT_DISABLE_OXLINT: "1" },
        },
      );
      const findings = JSON.parse(result.stdout) as { ruleId: string }[];
      expect(findings.some((finding) => finding.ruleId === ruleId)).toBe(true);
    });
  });

  test("one shared scan detects imports, barrels and inline snapshots", async () => {
    await withTempDir(async (dir) => {
      await writeRepositoryFiles(dir, {
        "src/index.test.js": [
          'import {addDays} from "date-fns";',
          ...Array.from({ length: 120 }, (_, index) => `export * from "./m${index}.js";`),
          "expect(addDays).toMatchInlineSnapshot(`",
          ...Array.from({ length: 60 }, (_, index) => `line ${index}`),
          "`);",
        ].join("\n"),
      });
      const context = new RepositoryScanContext(dir, []);
      const pending = collectSourceAudit(context);
      expect(collectSourceAudit(context)).toBe(pending);
      const audit = await pending;
      expect(audit.imports.some((entry) => entry.source === "date-fns" && entry.restricted)).toBe(
        true,
      );
      expect(audit.barrels).toHaveLength(1);
      expect(audit.snapshots).toHaveLength(1);
    });
  });

  test("ignores snapshot-generated source while retaining external snapshot checks", async () => {
    await withTempDir(async (dir) => {
      const source = [
        'import {addDays} from "date-fns";',
        "expect(addDays).toMatchInlineSnapshot(`",
        ...Array.from({ length: 60 }, (_, index) => `line ${index}`),
        "`);",
      ].join("\n");
      const external = [
        "exports[`large external snapshot 1`] = `",
        ...Array.from({ length: 305 }, (_, index) => `line ${index}`),
        "`;",
      ].join("\n");
      const generated = [
        "build.snapshot/asset.bundle/index.js",
        "nested/test.js.snapshot/asset.bundle/index.js",
        "__snapshots__/generated.test.js",
        "nested/__snapshots__/generated.test.js",
      ];
      await writeRepositoryFiles(dir, {
        "package.json": JSON.stringify({ devDependencies: { jest: "^30.0.0" } }),
        "src/source.test.js": source,
        "src/ordinary.snapshot.js": 'import {addDays} from "date-fns";',
        ...Object.fromEntries(generated.map((filename) => [filename, source])),
        "__snapshots__/source.test.js.snap": external,
        "nested/test.js.snapshot/external.snap": external,
      });
      const context = new RepositoryScanContext(dir, []);
      const audit = await collectSourceAudit(context);
      expect(audit.snapshots.map((entry) => entry.relativePath)).toEqual(["src/source.test.js"]);
      expect(audit.imports.map((entry) => entry.relativePath).sort()).toEqual([
        "src/ordinary.snapshot.js",
        "src/source.test.js",
      ]);
      const { signals } = await collectRepositorySignals(dir, [], [], context);
      const findings = await collectLargeJestSnapshotDiagnostics(
        dir,
        { ...signals, workflowCount: 1, primaryWorkflowPath: ".github/workflows/ci.yml" },
        [],
        context,
      );
      expect(
        findings
          .filter((finding) => finding.location.path.endsWith(".snap"))
          .map((finding) => finding.location.path)
          .sort(),
      ).toEqual(["__snapshots__/source.test.js.snap", "nested/test.js.snapshot/external.snap"]);
      const discovered = await context.walkFiles(".");
      for (const filename of generated) {
        expect(discovered).toContain(filename);
      }
    });
  });
});
