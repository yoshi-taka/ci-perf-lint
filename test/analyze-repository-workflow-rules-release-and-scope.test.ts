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

describe("analyzeRepository workflow and execution rules: release and scope", () => {
  test("does not flag a release-like downstream job when its if condition explicitly allows optional upstream skip paths", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardOptionalSkipOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
  });

  test("does not flag failure-only release notification jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-release-guard-notify-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "nightly.yml"),
      [
        "name: nightly",
        "on:",
        "  schedule:",
        "    - cron: '0 0 * * *'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  notify:",
        "    needs: build",
        "    if: failure()",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo notify",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
  });

  test("adds repository precedent context to missing-release-downstream-success-guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-release-guard-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "guarded.yml"),
      [
        "name: guarded",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  publish:",
        "    needs: build",
        "    if: always() && !failure() && !cancelled() && needs.build.result == 'success'",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo publish",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "unguarded.yml"),
      [
        "name: unguarded",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  publish:",
        "    needs: build",
        "    if: always()",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo publish",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-release-downstream-success-guard" &&
        candidate.workflow === ".github/workflows/unguarded.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already uses explicit downstream release success guards",
    );
    expect(finding?.why).toContain(".github/workflows/guarded.yml:publish");
  });

  test("does not flag reporting and upload downstream jobs using always()", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardReportingOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (c) => c.ruleId === "missing-release-downstream-success-guard",
    );

    expect(findings.some((f) => f.message.includes('job "report-test-results-to-datadog"'))).toBe(
      false,
    );
    expect(findings.some((f) => f.message.includes('job "upload-adapter-results"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('job "publish"'))).toBe(true);
  });

  test("keeps missing-timeout-minutes advisory when a heavy step already has its own timeout", async () => {
    const report = await getFixtureReport(fixtures.stepTimeoutOnlyLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-timeout-minutes",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("job-level timeout-minutes");
    expect(finding?.why).toContain("already times out at least one heavy step");
  });
});
