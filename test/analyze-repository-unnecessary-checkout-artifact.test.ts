import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
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

describe("unnecessary-checkout-when-only-using-artifacts rule", () => {
  test("flags checkout when job only uses artifact actions", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job has build commands", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when run steps reference repo files (e.g. create_release)", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactReleaseOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job uses git apply (needs working tree)", async () => {
    const report = await getFixtureReport(fixtures.unnecessaryCheckoutArtifactGitApplyOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job writes to repo file via shell redirection (> filename)", async () => {
    const fixtureRoot = await tempDirs.create("apl-chk-art-redirect-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: summarize",
        "on: pull_request",
        "jobs:",
        "  summarize:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/download-artifact@v4",
        "        with:",
        "          name: test-results",
        "      - run: |",
        '          echo "$(cat test-results/summary.json)" > report.md',
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: report",
        "          path: report.md",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job writes to repo file via tee", async () => {
    const fixtureRoot = await tempDirs.create("apl-chk-art-tee-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: format",
        "on: pull_request",
        "jobs:",
        "  format:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/download-artifact@v4",
        "        with:",
        "          name: results",
        "      - run: cat results.json | tee formatted.json",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: formatted",
        "          path: formatted.json",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });

  test("skips checkout when job writes to repo file via cp without ./ prefix", async () => {
    const fixtureRoot = await tempDirs.create("apl-chk-art-cp-no-prefix-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: process",
        "on: pull_request",
        "jobs:",
        "  process:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/download-artifact@v4",
        "        with:",
        "          name: data",
        "      - run: cp data.json output.json",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: output",
        "          path: output.json",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);
    expect(ruleIds).not.toContain("unnecessary-checkout-when-only-using-artifacts");
  });
});
