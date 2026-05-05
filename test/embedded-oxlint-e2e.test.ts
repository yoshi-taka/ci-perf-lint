import { describe, expect, test } from "bun:test";
import { mkdtemp, cp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dir, "..");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apl-e2e-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("e2e: bundled CLI with oxlint", () => {
  test("detects barrel files via node dist/cli.js", async () => {
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
        throw new Error(`CLI produced no output: exit=${result.status} stderr=${String(result.stderr).slice(0, 500)}`);
      }
      const output = JSON.parse(result.stdout);
      const findings = Array.isArray(output) ? output : output.findings ?? [];
      const barrelFinding = findings.find(
        (f: { ruleId: string }) => f.ruleId === "detected-large-barrel-file",
      );
      expect(barrelFinding).toBeDefined();
      expect(barrelFinding.message).toContain("large barrel file");
    });
  });
});
