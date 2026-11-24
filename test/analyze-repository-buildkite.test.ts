import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";
import { parsePipeline } from "../src/buildkite-workflow.ts";

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
      mode: "strict",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(1);
    expect(ruleIds).toContain("missing-timeout-in-minutes-buildkite");

    const timeoutFinding = report.findings.find(
      (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
    );
    expect(timeoutFinding).toBeDefined();
    expect(timeoutFinding?.severity).toBe("warning");
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

test("parses plugins in sequence and map form", () => {
  const pipeline = [
    "steps:",
    "  - label: ':rocket: Deploy!'",
    "    plugins:",
    "      - acme-deploy#v1.0.0:",
    "          context: production",
    "      - docker#v5.13.0: { image: node:18 }",
    "  - label: Annotate",
    "    plugins: [test-summary#v1.2.3]",
    "  - label: 'Map form'",
    "    plugins:",
    "      acme-deploy#v2.0.0:",
    "        context: production",
  ].join("\n");

  const doc = parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", pipeline);

  expect(doc.steps[0]?.plugins).toEqual([
    { "acme-deploy#v1.0.0": { context: "production" } },
    { "docker#v5.13.0": { image: "node:18" } },
  ]);
  expect(doc.steps[1]?.plugins).toEqual([{ "test-summary#v1.2.3": undefined }]);
  expect(doc.steps[2]?.plugins).toEqual([{ "acme-deploy#v2.0.0": { context: "production" } }]);
});

test("flags plugin-only heavy steps without timeout_in_minutes", async () => {
  const root = await tempDirs.create("apl-buildkite-plugin-heavy-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - label: ':rocket: Deploy!'",
      "    plugins:",
      "      - acme-deploy#v1.0.0:",
      "          context: production",
      "  - label: ':rocket: Deploy!'",
      "    plugins:",
      "      acme-deploy#v1.0.0:",
      "        context: production",
      "    timeout_in_minutes: 15",
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
  expect(findings[0]?.message).toContain('Step ":rocket: Deploy!"');
});

test("flattens group steps so inner steps are visible to rules", async () => {
  const root = await tempDirs.create("apl-buildkite-group-inner-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - group: deploy",
      "    steps:",
      "      - label: ':rocket: Deploy!'",
      "        plugins:",
      "          - acme-deploy#v1.0.0:",
      "              context: production",
      "  - group: safe",
      "    steps:",
      "      - label: ':rocket: Deploy!'",
      "        plugins:",
      "          - acme-deploy#v1.0.0:",
      "              context: production",
      "        timeout_in_minutes: 15",
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
  expect(findings[0]?.message).toContain('Step ":rocket: Deploy!"');
});

test("does not flag steps skipped with the documented boolean form", async () => {
  const root = await tempDirs.create("apl-buildkite-skip-bool-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - label: ':fire: Skipped Heavy'",
      "    command: npm run build",
      "    skip: true",
      "  - label: ':fire: Real Heavy'",
      "    command: npm run build",
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
  expect(findings[0]?.message).toContain('Step ":fire: Real Heavy"');
});

test("normalizes documented bool and int step scalars", () => {
  const doc = parsePipeline(
    "/repo/.buildkite/pipeline.yml",
    "/repo",
    [
      "steps:",
      "  - label: a",
      "    command: echo hi",
      "    skip: true",
      "    parallelism: 4",
      "  - label: b",
      "    command: echo hi",
      "    skip: false",
    ].join("\n"),
  );
  expect(doc.steps[0]?.skip).toBe(true);
  expect(doc.steps[0]?.parallelism).toBe(4);
  expect(doc.steps[1]?.skip).toBe(false);
});

test("does not flag light annotator plugins regardless of label", async () => {
  const root = await tempDirs.create("apl-buildkite-plugin-light-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      '  - label: "Annotate with test results"',
      "    plugins:",
      "      - test-summary#v1.0: {junit: a.xml}",
      '  - label: "Annotate with test results"',
      "    plugins:",
      "      - junit-annotate#v2.9.0: {junit: a.xml}",
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
  expect(findings).toHaveLength(0);
});

test("flags heavy plugins regardless of step label", async () => {
  const root = await tempDirs.create("apl-buildkite-plugin-heavy-name-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      '  - label: "Security scan"',
      "    plugins:",
      "      - docker#v5.13.0: {}",
      "  - label: Lint",
      "    plugins:",
      "      - docker-compose#v1.0: {}",
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
  expect(findings).toHaveLength(2);
  expect(findings[0]?.message).toContain('Step "Security scan"');
  expect(findings[1]?.message).toContain('Step "Lint"');
});

test("falls back to the label hint only for unknown plugins", async () => {
  const root = await tempDirs.create("apl-buildkite-plugin-unknown-");
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "pipeline.yml"),
    [
      "steps:",
      "  - label: Notify",
      "    plugins:",
      "      - slack-notify#v3.0: {}",
      "  - label: Build artifacts",
      "    plugins:",
      "      - custom-runner#v1.0: {}",
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
  expect(findings[0]?.message).toContain('Step "Build artifacts"');
});
