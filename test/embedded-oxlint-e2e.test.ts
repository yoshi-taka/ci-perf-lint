import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
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

describe("e2e: packaged CLI with oxlint", () => {
  test("detects barrel files when run from npm pack install", async () => {
    await withTempDir(async (tmpDir) => {
      const installDir = path.join(tmpDir, "project");
      await mkdir(installDir, { recursive: true });

      // Copy fixture
      const fixtureRoot = path.join(repoRoot, "test", "fixtures", "barrel-file-like");
      await cp(fixtureRoot, path.join(installDir, "fixture"), { recursive: true });

      // Create package.json for the e2e project
      await writeFile(
        path.join(installDir, "package.json"),
        JSON.stringify({ name: "e2e-test", private: true }),
      );

      // Pre-build so prepack doesn't pollute stdout
      spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
      const packResult = spawnSync("bun", ["pm", "pack", "--quiet", "--ignore-scripts"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      if (packResult.status !== 0) {
        throw new Error(`bun pm pack failed: ${packResult.stderr.toString()}`);
      }
      const tarballName = packResult.stdout.toString().trim().split("\n").filter((l) => l.endsWith(".tgz")).pop();
      if (!tarballName) {
        throw new Error(`no .tgz in pack output: ${packResult.stdout.toString()}`);
      }
      const srcTarball = path.join(repoRoot, tarballName);
      const dstTarball = path.join(tmpDir, tarballName);
      await cp(srcTarball, dstTarball);
      await rm(srcTarball);

      // Install the packed tool + its deps into the e2e project
      const installResult = spawnSync("bun", ["add", dstTarball, "oxlint"], {
        cwd: installDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      if (installResult.status !== 0) {
        throw new Error(`bun add failed with exit ${installResult.status}: ${installResult.stderr}`);
      }

      // Run the installed CLI
      const binPath = path.join(
        installDir,
        "node_modules",
        ".bin",
        "ci-perf-lint",
      );
      expect(existsSync(binPath)).toBe(true);

      const result = spawnSync(
        "node",
        [binPath, "--findings-only", path.join(installDir, "fixture"), "--format", "json"],
        { cwd: installDir, stdio: "pipe", encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      );
      if (result.status !== 0 || !result.stdout) {
        throw new Error(`CLI exited ${result.status}: stdout=${result.stdout?.slice(0, 500)} stderr=${result.stderr?.slice(0, 500)}`);
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
