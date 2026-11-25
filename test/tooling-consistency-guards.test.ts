import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { Bench } from "tinybench";
import { getPublishPlan } from "../scripts/publish-package-status.ts";
import { failedBenchmarkTasks } from "../bench/benchmark-results.ts";
import { allRules } from "../src/rules/index.ts";
import { analyzeRepository } from "../src/repo.ts";

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
  test("elan download retries transient failures with bounded time and verifies its checksum", async () => {
    const text = await readFile(path.join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
    const doc = parseDocument(text).toJS() as {
      jobs: { formal: { steps: { name?: string; run?: string }[] } };
    };
    const script = doc.jobs.formal.steps.find((step) => step.name === "Install pinned elan")?.run;
    expect(script).toBeDefined();
    expect(script).toContain("curl --fail --location --silent --show-error");
    expect(script).toContain("--retry 4 --retry-delay 2 --retry-max-time 120");
    expect(script).toContain("--connect-timeout 15 --max-time 60");
    expect(script).not.toContain("--retry-all-errors");
    expect(script).toContain(
      "https://github.com/leanprover/elan/releases/download/v4.2.4/elan-aarch64-unknown-linux-gnu.tar.gz",
    );
    expect(script).toContain(
      'echo "05febd124d84ebf994b2e7479922a5650b1e950c17ae3bd1ddd776b65bb72bf9  $dir/elan.tar.gz" | sha256sum --check',
    );
    expect(script!.indexOf("sha256sum --check")).toBeLessThan(script!.indexOf("tar -xzf"));
  });

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

  test("CodSpeed benchmarks PRs and main, not duplicate release-tag pushes", async () => {
    const text = await readFile(
      path.join(import.meta.dir, "../.github/workflows/codspeed.yml"),
      "utf8",
    );
    const doc = parseDocument(text).toJS() as {
      on: {
        push: { branches: string[]; tags?: string[]; "tags-ignore"?: string[] };
        pull_request?: unknown;
        workflow_dispatch?: unknown;
      };
    };
    expect(doc.on.push.branches).toEqual(["main"]);
    expect(doc.on.push.tags).toBeUndefined();
    expect(doc.on.push["tags-ignore"]).toBeUndefined();
    expect(Object.hasOwn(doc.on, "pull_request")).toBe(true);
    expect(Object.hasOwn(doc.on, "workflow_dispatch")).toBe(true);
  });

  test("CodSpeed caches dependency downloads before an unconditional frozen install", async () => {
    const text = await readFile(
      path.join(import.meta.dir, "../.github/workflows/codspeed.yml"),
      "utf8",
    );
    const doc = parseDocument(text).toJS() as {
      jobs: {
        benchmarks: {
          steps: {
            uses?: string;
            run?: string;
            if?: unknown;
            with?: { path?: string; key?: string };
          }[];
        };
      };
    };
    const steps = doc.jobs.benchmarks.steps;
    const cacheIndex = steps.findIndex(
      (step) => step.uses === "actions/cache@v5" && step.with?.path === "~/.bun/install/cache",
    );
    const installIndex = steps.findIndex((step) =>
      step.run?.startsWith("bun install --frozen-lockfile"),
    );
    expect(cacheIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeGreaterThan(cacheIndex);
    expect(steps[cacheIndex]?.with?.key).toContain("hashFiles('bun.lock')");
    expect(steps[installIndex]?.if).toBeUndefined();
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
