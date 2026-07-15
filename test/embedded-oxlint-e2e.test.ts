import { describe, expect, test } from "bun:test";
import { mkdtemp, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { allEmbeddedOxlintScanPlan } from "../src/repository-diagnostics/embedded-oxlint-config.ts";
import { runEmbeddedOxlint } from "../src/repository-diagnostics/embedded-oxlint-runner.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apl-e2e-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ensureCliBuilt(): Promise<void> {
  const srcPath = path.join(repoRoot, "src", "cli.ts");
  const distPath = path.join(repoRoot, "dist", "cli.js");

  const srcStat = await stat(srcPath).catch(() => null);
  const distStat = await stat(distPath).catch(() => null);

  if (!srcStat || !distStat || srcStat.mtimeMs > distStat.mtimeMs) {
    spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  }
}

describe("e2e: bundled CLI with oxlint", () => {
  test("combined config returns the union of separate scan diagnostics", async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, "src");
      await mkdir(srcDir);
      await writeFile(
        path.join(srcDir, "index.js"),
        [
          'import { addDays } from "date-fns";',
          ...Array.from({ length: 120 }, (_, index) => `export * from "./m${index}.js";`),
          "console.log(addDays);",
        ].join("\n"),
      );

      const [importDiagnostics, nonImportDiagnostics, combinedDiagnostics] = await Promise.all([
        runEmbeddedOxlint(tmpDir, {
          importExtensions: true,
          restrictedImports: true,
          barrels: false,
          snapshots: false,
        }),
        runEmbeddedOxlint(tmpDir, {
          importExtensions: false,
          restrictedImports: false,
          barrels: true,
          snapshots: true,
        }),
        runEmbeddedOxlint(tmpDir, allEmbeddedOxlintScanPlan),
      ]);
      const diagnosticKeys = (diagnostics: Awaited<ReturnType<typeof runEmbeddedOxlint>>) =>
        (diagnostics ?? [])
          .map(
            (diagnostic) =>
              `${diagnostic.code}\n${diagnostic.filename}\n${diagnostic.line}\n${diagnostic.column}\n${diagnostic.message}`,
          )
          .sort();

      expect(diagnosticKeys(combinedDiagnostics)).toEqual(
        [...diagnosticKeys(importDiagnostics), ...diagnosticKeys(nonImportDiagnostics)].sort(),
      );
    });
  });

  test("detects barrel files via node dist/cli.js", async () => {
    await ensureCliBuilt();
    await withTempDir(async (tmpDir) => {
      const fixtureDir = path.join(tmpDir, "fixture");
      const fixtureRoot = path.join(repoRoot, "test", "fixtures", "barrel-file-like");
      await cp(fixtureRoot, fixtureDir, { recursive: true });

      const result = spawnSync(
        "node",
        [path.join(repoRoot, "dist", "cli.js"), "--findings-only", fixtureDir, "--format", "json"],
        { cwd: repoRoot, stdio: "pipe", encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      );
      if (!result.stdout) {
        throw new Error(
          `CLI produced no output: exit=${result.status} stderr=${String(result.stderr).slice(0, 500)}`,
        );
      }
      const output = JSON.parse(result.stdout);
      const findings = Array.isArray(output) ? output : (output.findings ?? []);
      const barrelFinding = findings.find(
        (f: { ruleId: string }) => f.ruleId === "detected-large-barrel-file",
      );
      expect(barrelFinding).toBeDefined();
      expect(barrelFinding.message).toContain("large barrel file");
    });
  });
});
