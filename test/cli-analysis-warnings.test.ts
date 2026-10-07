import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/main.ts";
import path from "node:path";
import { createLogger, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

describe("CLI analysis warnings", () => {
  test("debug workflow counts agree with the rendered report", async () => {
    const cwd = await tempDirs.create("apl-debug-count-");
    await writeRepositoryFiles(cwd, {
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
    });
    const process = Bun.spawn(
      [
        "bun",
        path.join(import.meta.dir, "../src/cli.ts"),
        cwd,
        "--workflow-only",
        "--format",
        "json",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...globalThis.process.env, CI_PERF_LINT_DUMP_STATE: "1" },
      },
    );
    const [stdout, stderr] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    const stateLine = stderr
      .split("\n")
      .find((line) => line.includes('"type":"repo-analysis-state"'));
    expect(stateLine).toBeDefined();
    const state = JSON.parse(stateLine!) as {
      normalizationMetadata: { totalWorkflows: number; workflowDocKinds: Record<string, number> };
    };
    const report = JSON.parse(stdout) as { workflowCount: number };
    expect(state.normalizationMetadata.totalWorkflows).toBe(report.workflowCount);
    expect(state.normalizationMetadata.workflowDocKinds).toEqual({ "github-actions": 1 });
  });
  test("warns about an invalid workflow without changing clean exit or JSON stdout", async () => {
    const cwd = await tempDirs.create("apl-parse-warning-");
    await writeRepositoryFiles(cwd, { ".github/workflows/broken.yml": "jobs: [\n" });
    const { logger, lines, errors } = createLogger();
    const code = await runCli(
      ["--workflow-only", "--findings-only", "--format", "json"],
      cwd,
      logger,
    );
    expect(code).toBe(0);
    expect(JSON.parse(lines[0]!)).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Warning: Failed to parse workflow");
    expect(errors[0]).toContain("broken.yml");
  });

  test("keeps findings from valid workflows alongside a parse warning", async () => {
    const cwd = await tempDirs.create("apl-partial-parse-");
    await writeRepositoryFiles(cwd, {
      ".github/workflows/broken.yml": "jobs: [\n",
      ".github/workflows/valid.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n",
    });
    const { logger, lines, errors } = createLogger();
    const code = await runCli(
      ["--workflow-only", "--mode", "exploratory", "--format", "json"],
      cwd,
      logger,
    );
    expect(code).toBe(1);
    expect(JSON.parse(lines[0]!).workflowCount).toBe(1);
    expect(errors.some((error) => error.includes("broken.yml"))).toBe(true);
  });

  test("does not treat option values as a version request", async () => {
    const { logger, lines, errors } = createLogger();
    expect(await runCli(["--format", "--v"], process.cwd(), logger)).toBe(2);
    expect(lines).toEqual([]);
    expect(errors).toEqual(["Unsupported format: --v"]);
  });

  test.each(["--version", "--v"])("accepts the version flag %s", async (flag) => {
    const { logger, lines, errors } = createLogger();
    expect(await runCli([flag], process.cwd(), logger)).toBe(0);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+/);
    expect(errors).toEqual([]);
  });
});
