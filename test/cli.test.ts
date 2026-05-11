import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/main.ts";
import { fixtures } from "./fixtures.ts";
import { createLogger, createTempDirTracker, memoizedRunCliCapture } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("runCli", () => {
  test("shows selected workflows without running the audit", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [".", "--show-workflows"],
      fixtures.sampleRepo,
    );

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(lines[0]).toContain("Workflows selected:");
    expect(lines[0]).toContain(".github/workflows/ci.yml");
    expect(lines[0]).toContain(".github/workflows/docs.yml");
    expect(lines[0]).toContain("Total: 2 workflows");
  });

  test("shows selected workflows for a direct workflows directory path", async () => {
    const { exitCode, lines } = await memoizedRunCliCapture(
      ["--show-workflows", path.join(fixtures.geminiCli, ".github", "workflows")],
      process.cwd(),
    );

    expect(exitCode).toBe(0);
    expect(lines[0]).toContain("Workflows selected:");
    expect(lines[0]).toContain(".github/workflows/chained_e2e.yml");
    expect(lines[0]).toContain("Total: 45 workflows");
  });

  test("returns an error for a missing target path with show-workflows", async () => {
    const { logger, lines, errors } = createLogger();
    const missingPath = path.join(os.tmpdir(), "apl-missing-show-workflows-path");

    const exitCode = await runCli(["--show-workflows", missingPath], process.cwd(), logger);

    expect(exitCode).toBe(2);
    expect(lines).toHaveLength(0);
    expect(errors).toEqual([`Target path not found: ${missingPath}`]);
  });

  test("emits timing lines to stderr when enabled", async () => {
    const { logger, lines, errors } = createLogger();
    const originalValue = process.env.CI_PERF_LINT_TIMINGS;
    const originalWrite = process.stderr.write.bind(process.stderr);
    const stderrLines: string[] = [];

    process.env.CI_PERF_LINT_TIMINGS = "1";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await runCli(
        [fixtures.cleanNoFindings, "--format", "json"],
        process.cwd(),
        logger,
      );

      expect(exitCode).toBe(0);
      expect(lines).toHaveLength(1);
      expect(errors).toHaveLength(0);
      expect(stderrLines.some((line) => line.includes("[timing] analyzeRepository"))).toBe(true);
      expect(stderrLines.some((line) => line.includes("[timing] runCli="))).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
      if (originalValue === undefined) {
        delete process.env.CI_PERF_LINT_TIMINGS;
      } else {
        process.env.CI_PERF_LINT_TIMINGS = originalValue;
      }
    }
  });

  test("accepts a direct workflow file path", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [path.join(fixtures.sampleRepo, ".github", "workflows", "ci.yml"), "--format", "text"],
      process.cwd(),
    );

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(0);
    expect(lines[0]).toContain("ci-perf-lint");
    expect(lines[0]).toContain("Workflows scanned: 1");
    expect(lines[0]).toContain("deep-checkout-without-need");
  });

  test("shows only the selected workflow when show-workflows receives a direct workflow file path", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [path.join(fixtures.sampleRepo, ".github", "workflows", "ci.yml"), "--show-workflows"],
      process.cwd(),
    );

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(lines[0]).toContain("Workflows selected:");
    expect(lines[0]).toContain(".github/workflows/ci.yml");
    expect(lines[0]).not.toContain(".github/workflows/docs.yml");
    expect(lines[0]).toContain("Total: 1 workflow");
  });

  test("shows a direct GitLab CI file with show-workflows", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [path.join(fixtures.gitlabCiTimeoutLike, ".gitlab-ci.yml"), "--show-workflows"],
      process.cwd(),
    );

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(lines[0]).toContain("Workflows selected:");
    expect(lines[0]).toContain(".gitlab-ci.yml");
    expect(lines[0]).toContain("Total: 1 workflow");
  });

  test("shows Buildkite pipeline.json files during workflow selection", async () => {
    const fixtureRoot = await tempDirs.create("apl-buildkite-json-show-");
    const buildkiteDir = path.join(fixtureRoot, ".buildkite");
    await mkdir(buildkiteDir, { recursive: true });
    await writeFile(path.join(buildkiteDir, "pipeline.json"), '{ "steps": [] }\n');

    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [fixtureRoot, "--show-workflows"],
      process.cwd(),
    );

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(lines[0]).toContain(".buildkite/pipeline.json");
    expect(lines[0]).toContain("Total: 1 workflow");
  });

  test("can render only workflow findings", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [fixtures.barrelFileLike, "--workflow-only", "--findings-only", "--format", "json"],
      process.cwd(),
    );

    const findings = JSON.parse(lines[0] ?? "[]") as { scope?: string }[];

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(0);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.scope !== "repository")).toBe(true);
  });

  test("can render only repository-wide findings", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [fixtures.barrelFileLike, "--repository-only", "--findings-only", "--format", "json"],
      process.cwd(),
    );

    const findings = JSON.parse(lines[0] ?? "[]") as { scope?: string }[];

    expect(exitCode).toBe(1);
    expect(errors).toHaveLength(0);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.scope === "repository")).toBe(true);
  });

  test("accepts unique option prefixes", async () => {
    const { exitCode, lines, errors } = await memoizedRunCliCapture(
      [fixtures.barrelFileLike, "--repo", "--find", "--form", "json"],
      process.cwd(),
    );

    const findings = JSON.parse(lines[0] ?? "[]") as { scope?: string }[];

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      "Resolved option --repo as --repository-only",
      "Resolved option --find as --findings-only",
      "Resolved option --form as --format",
    ]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.scope === "repository")).toBe(true);
  });

  test("rejects ambiguous option prefixes", async () => {
    const { logger, lines, errors } = createLogger();

    const exitCode = await runCli(["--show"], process.cwd(), logger);

    expect(exitCode).toBe(2);
    expect(lines).toHaveLength(0);
    expect(errors).toEqual([
      "ambiguous option: --show (could be --show-workflows, --show-all-locations)",
    ]);
  });

  test("rejects conflicting finding scope flags", async () => {
    const { logger, lines, errors } = createLogger();

    const exitCode = await runCli(["--workflow-only", "--repository-only"], process.cwd(), logger);

    expect(exitCode).toBe(2);
    expect(lines).toHaveLength(0);
    expect(errors).toEqual(["--workflow-only and --repository-only cannot be used together"]);
  });

  test("returns an error for a missing target path", async () => {
    const { logger, lines, errors } = createLogger();
    const missingPath = path.join(os.tmpdir(), "apl-missing-target-path");

    const exitCode = await runCli([missingPath], process.cwd(), logger);

    expect(exitCode).toBe(2);
    expect(lines).toHaveLength(0);
    expect(errors).toEqual([`Target path not found: ${missingPath}`]);
  });

  test("rejects multiple positional target paths", async () => {
    const { logger, lines, errors } = createLogger();

    const exitCode = await runCli(
      [fixtures.sampleRepo, fixtures.cleanNoFindings, "--show-workflows"],
      process.cwd(),
      logger,
    );

    expect(exitCode).toBe(2);
    expect(lines).toHaveLength(0);
    expect(errors).toEqual([`Unexpected extra positional argument: ${fixtures.cleanNoFindings}`]);
  });

  test("returns an error when a workflow file cannot be parsed as YAML", async () => {
    const fixtureRoot = await tempDirs.create("apl-invalid-workflow-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      '{"name":"invalid-workflow-fixture"}\n',
    );
    await writeFile(
      path.join(workflowDir, "ok.yml"),
      ["name: ok", "on: push", "jobs:", "  test:", "    runs-on: ubuntu-latest"].join("\n"),
    );
    await writeFile(
      path.join(workflowDir, "bad.yml"),
      ["name: broken", "on: push", "jobs:", "  bad: ["].join("\n"),
    );

    const { logger, errors } = createLogger();
    const exitCode = await runCli([fixtureRoot], process.cwd(), logger);

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });
});
