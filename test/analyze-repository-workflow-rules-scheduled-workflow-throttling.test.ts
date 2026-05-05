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

describe("analyzeRepository workflow and execution rules: scheduled workflow throttling", () => {
  test("suggests throttling heavy scheduled workflows that run more often than every 3 hours", async () => {
    const report = await getFixtureReport(fixtures.scheduledHeavyLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "scheduled-heavy-workflow-without-throttling",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("runs more often than every 3 hours");
  });

  test("does not flag heavy scheduled workflows when the visible cadence is already reduced", async () => {
    const report = await getFixtureReport(fixtures.scheduledHeavyOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "scheduled-heavy-workflow-without-throttling",
      ),
    ).toBe(false);
  });

  test("adds repository precedent context to scheduled-heavy-workflow-without-throttling", async () => {
    const fixtureRoot = await tempDirs.create("apl-throttled-schedule-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "slow.yml"),
      [
        "name: Slow Heavy",
        "on:",
        "  schedule:",
        "    - cron: '0 */6 * * *'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "fast.yml"),
      [
        "name: Fast Heavy",
        "on:",
        "  schedule:",
        "    - cron: '0 * * * *'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "scheduled-heavy-workflow-without-throttling" &&
        candidate.workflow === ".github/workflows/fast.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already keeps other heavy scheduled workflows at a slower cadence",
    );
    expect(finding?.why).toContain(".github/workflows/slow.yml");
  });
});
