import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("analyzeRepository Buildkite pipeline rules", () => {
  test("finds missing timeout_in_minutes in Buildkite pipeline", async () => {
    const report = await getFixtureReport(fixtures.buildkiteTimeoutLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).toContain("missing-timeout-in-minutes-buildkite");

    const timeoutFinding = report.findings.find(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
    );
    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.message).toContain("timeout_in_minutes");
  });

  test("does not flag timeouts when all heavy steps have timeout", async () => {
    const report = await getFixtureReport(fixtures.buildkiteTimeoutOk, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).not.toContain("missing-timeout-in-minutes-buildkite");
  });

  test("aggregates multiple missing timeout findings in the report", async () => {
    const report = await getFixtureReport(fixtures.buildkiteTimeoutMultiLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleFindings = report.findings.filter(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
    );
    const aggregated = report.topAggregatedFindings.find(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
    );

    expect(ruleFindings.length).toBe(2);
    expect(aggregated).toBeDefined();
    expect(aggregated?.locations.length).toBe(2);
    expect(aggregated?.jobs.length).toBe(0);
    expect(aggregated?.messages.length).toBe(2);
    expect(aggregated?.locations[0]).toContain("pipeline.yml");
  });

  test("applies 'scope: both' rules to Buildkite pipelines", async () => {
    const report = await getFixtureReport(fixtures.buildkiteTimeoutLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(ruleIds).toContain("missing-timeout-in-minutes-buildkite");
  });

  test("accepts a direct Buildkite pipeline.json target", async () => {
    const fixtureRoot = await tempDirs.create("apl-buildkite-json-target-");
    const buildkiteDir = path.join(fixtureRoot, ".buildkite");
    await mkdir(buildkiteDir, { recursive: true });
    await writeFile(
      path.join(buildkiteDir, "pipeline.json"),
      JSON.stringify({
        steps: [
          {
            label: "Test",
            command: "bun test --bail",
          },
        ],
      }),
    );
    await writeFile(
      path.join(buildkiteDir, "other.yml"),
      [
        "steps:",
        "  - label: Slow",
        "    command: bun test --bail",
        "    timeout_in_minutes: 30",
      ].join("\n"),
    );

    const report = await getFixtureReport(process.cwd(), {
      targetPath: path.join(fixtureRoot, ".buildkite", "pipeline.json"),
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(1);
    expect(report.workflows[0]?.path).toBe(".buildkite/pipeline.json");
    expect(
      report.findings.some((finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite"),
    ).toBe(true);
  });
});

test("does not treat a .buildkite path substring as a heavy build step", async () => {
  const root = await tempDirs.create("apl-buildkite-path-heavy-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - label: Check",
      "    command: .buildkite/steps/check-version-string.sh",
      "  - label: Build",
      "    command: make build",
    ].join("\n"),
  );
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Step "Build"');
});

test("does not treat a release pipeline upload step as a heavy build", async () => {
  const root = await tempDirs.create("apl-buildkite-upload-pipeline-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - label: Upload Release Pipeline",
      "    command: buildkite-agent pipeline upload .buildkite/release.yml",
      "  - label: Build Release",
      "    command: ./build-release.sh",
    ].join("\n"),
  );
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  const findings = report.findings.filter(
    (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
  );
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('Step "Build Release"');
});
