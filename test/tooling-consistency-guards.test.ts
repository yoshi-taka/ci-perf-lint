import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { Bench } from "tinybench";
import { getPublishPlan } from "../scripts/publish-package-status.ts";
import { failedBenchmarkTasks } from "../bench/benchmark-results.ts";
import { allRules } from "../src/rules/index.ts";
import { spawnOxlintProcess } from "../src/repository-diagnostics/embedded-oxlint-spawn.ts";
import { analyzeRepository } from "../src/repo.ts";

describe("external process failures", () => {
  test("settles every stream and status when an executable is missing", async () => {
    const process = spawnOxlintProcess(
      [path.join(import.meta.dir, "missing-oxlint-executable")],
      import.meta.dir,
    );
    const [out, err, code] = await Promise.all([process.stdout, process.stderr, process.exited]);
    expect(out).toBe("");
    expect(err).toContain("ENOENT");
    expect(code).toBe(1);
    expect(process.timedOut).toBe(false);
  });
});

describe("publish idempotency", () => {
  const version = "1.2.0";
  test.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("handles scoped=%s wrapper=%s", async (scoped, wrapper) => {
    const plan = await getPublishPlan(version, (specifier) => {
      const exists = specifier.startsWith("@") ? scoped : wrapper;
      return Promise.resolve(
        exists
          ? { exitCode: 0, stdout: JSON.stringify(version) }
          : { exitCode: 1, stdout: '{"error":{"code":"E404"}}' },
      );
    });
    expect(plan).toEqual({ publishScoped: !scoped, publishWrapper: !wrapper });
  });
  test("does not interpret registry errors as an unpublished version", async () => {
    const failure = await getPublishPlan(version, () =>
      Promise.resolve({ exitCode: 1, stdout: '{"error":{"code":"E503"}}' }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(failure instanceof Error)) {
      throw new Error("Expected registry lookup to fail");
    }
    expect(failure.message).toContain("Cannot determine registry status");
  });
});

describe("benchmark and documentation guards", () => {
  test("repository workflows pass strict self-audit", async () => {
    const root = path.resolve(import.meta.dir, "..");
    const report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      workflowOnly: true,
      mode: "strict",
      topCount: 100,
    });
    expect(report.workflowCount).toBeGreaterThan(0);
    expect(report.findings).toEqual([]);
    expect(
      report.analysisWarnings.some(
        (warning) => warning.kind === "parser-error" || warning.kind === "rule-error",
      ),
    ).toBe(false);
  });

  test("CodSpeed retains version-tag and manual benchmark triggers", async () => {
    const text = await readFile(
      path.join(import.meta.dir, "../.github/workflows/codspeed.yml"),
      "utf8",
    );
    const doc = parseDocument(text).toJS() as {
      on: { push: { tags: string[] }; workflow_dispatch?: unknown };
    };
    expect(doc.on.push.tags).toContain("v*");
    expect(Object.hasOwn(doc.on, "workflow_dispatch")).toBe(true);
  });

  test("detects task failures even when Tinybench.run resolves", async () => {
    const bench = new Bench({ iterations: 1, time: 0, warmup: false });
    bench
      .add("ok", () => {})
      .add("failed", () => {
        throw new Error("target failed");
      });
    await bench.run();
    expect(failedBenchmarkTasks(bench)).toEqual(["failed"]);
  });

  test("documents every workflow rule and multi-rule Docker/Husky findings", async () => {
    const root = path.join(import.meta.dir, "..");
    const index = await readFile(path.join(root, "docs/rules/README.md"), "utf8");
    const documented = new Set([...index.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]));
    for (const rule of allRules) {
      expect(documented.has(rule.meta.id)).toBe(true);
    }
    for (const id of [
      "dockerfile-bun-install-without-frozen-lockfile",
      "missing-dockerignore-for-build-context",
      "outdated-husky-version",
    ]) {
      expect(documented.has(id)).toBe(true);
    }
  });

  test("workflow publication consumes both package status outputs", async () => {
    const text = await readFile(
      path.join(import.meta.dir, "../.github/workflows/publish.yml"),
      "utf8",
    );
    const doc = parseDocument(text).toJS() as {
      jobs: { publish: { steps: { name: string; if?: string }[] } };
    };
    const steps = doc.jobs.publish.steps;
    expect(steps.find((step) => step.name === "Publish scoped package")?.if).toBe(
      "steps.published.outputs.publish_scoped == 'true'",
    );
    expect(steps.find((step) => step.name === "Publish unscoped package")?.if).toBe(
      "steps.published.outputs.publish_wrapper == 'true'",
    );
  });
});
