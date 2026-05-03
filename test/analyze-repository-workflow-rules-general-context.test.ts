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

describe("analyzeRepository workflow and execution rules: general context", () => {
  test("does not flag deep checkout when tag publishing visibly needs history or tags", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutReleaseLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when versioning work visibly needs history", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutVersionLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a repo-local script hides its history needs", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutOpaqueScript, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a bare dev script may hide history usage", async () => {
    const fixtureRoot = await tempDirs.create("apl-deep-checkout-dev-script-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "dev"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name":"dev-script-fixture"}');
    await writeFile(path.join(fixtureRoot, "dev", "update-authors.js"), "console.log('x')\n");
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "authors.yml"),
      [
        "name: authors",
        "on: workflow_dispatch",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - run: dev/update-authors.js",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when a write-capable issue-management action may mutate the repository", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutMutatingAction, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("does not flag deep checkout when the job explicitly pulls, rebases, commits, and pushes", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutRebasePush, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "deep-checkout-without-need")).toBe(
      false,
    );
  });

  test("treats commitlint full-history checkout as intentional but still suggests blob:none", async () => {
    const report = await getFixtureReport(fixtures.metaCheckLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const deepCheckoutFinding = report.findings.find(
      (finding) => finding.ruleId === "deep-checkout-without-need",
    );
    const blobNoneFinding = report.findings.find(
      (finding) => finding.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(deepCheckoutFinding).toBeUndefined();
    expect(blobNoneFinding?.message).toContain('Job "commitlint"');
    expect(blobNoneFinding?.why).toContain("commit");
    expect(blobNoneFinding?.suggestion).toContain("filter: blob:none");
  });

  test("flags deep checkout when fetch-depth >= 1000 without history need", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveLike, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const finding = report.findings.find((f) => f.ruleId === "deep-checkout-excessive-depth");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("fetch-depth: 1000");
    expect(finding?.suggestion).toContain("Reduce fetch-depth");
    expect(finding?.severity).toBe("warning");
  });

  test("does not flag deep checkout with fetch-depth >= 1000 when history-dependent command is present", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveOkUsesHistory, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((f) => f.ruleId === "deep-checkout-excessive-depth")).toBe(false);
  });

  test("does not flag deep checkout with fetch-depth >= 1000 in a release-like workflow", async () => {
    const report = await getFixtureReport(fixtures.deepCheckoutExcessiveOkRelease, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(report.findings.some((f) => f.ruleId === "deep-checkout-excessive-depth")).toBe(false);
  });

  test("defaults to warning-only output", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 10,
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("missing-concurrency")).toBe(false);
    expect(ruleIds.has("missing-paths-filter")).toBe(false);
    expect(ruleIds.has("missing-path-ignore-for-non-code")).toBe(false);
    expect(ruleIds.has("missing-dependency-cache")).toBe(false);
    expect(ruleIds.has("ungated-heavy-job")).toBe(false);
  });

  test("keeps a clean fixture at zero findings in both strict and exploratory mode", async () => {
    const strictReport = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });
    const exploratoryReport = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    expect(strictReport.findings).toHaveLength(0);
    expect(exploratoryReport.findings).toHaveLength(0);
    expect(strictReport.workflowCount).toBe(1);
    expect(exploratoryReport.workflowCount).toBe(1);
  });

  test("supports exploratory mode for advisory findings", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-path-ignore-for-non-code")).toBe(true);
  });

  test("suggests dorny paths-filter for component-scoped heavy jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-dorny-paths-filter-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  backend:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm run test:api",
        "  frontend:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm run test:web",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-dorny-paths-filter-for-scoped-jobs",
    );

    expect(finding?.message).toContain('"backend"');
    expect(finding?.message).toContain('"frontend"');
    expect(finding?.suggestion).toContain("dorny/paths-filter@v3");
  });

  test("does not suggest dorny paths-filter when the workflow already uses it", async () => {
    const fixtureRoot = await tempDirs.create("apl-dorny-paths-filter-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  changes:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: dorny/paths-filter@v3",
        "        with:",
        "          filters: |",
        "            backend:",
        "              - 'apps/api/**'",
        "            frontend:",
        "              - 'apps/web/**'",
        "  backend:",
        "    needs: changes",
        "    if: ${{ needs.changes.outputs.backend == 'true' }}",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm run test:api",
        "  frontend:",
        "    needs: changes",
        "    if: ${{ needs.changes.outputs.frontend == 'true' }}",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm run test:web",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-dorny-paths-filter-for-scoped-jobs",
      ),
    ).toBe(false);
  });

  test("does not flag ungated heavy jobs in a small repository", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("ungated-heavy-job")).toBe(false);
  });

  test("does not suggest ungated heavy jobs for workflow_dispatch-only workflows", async () => {
    const report = await getFixtureReport(fixtures.manualHeavyLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("ungated-heavy-job")).toBe(false);
  });

  test("warns for heavy runtime OS package installs on heavy jobs", async () => {
    const report = await getFixtureReport(fixtures.osPackageInstallLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const warningFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image" &&
        candidate.severity === "warning",
    );
    const suggestionFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image" &&
        candidate.severity === "suggestion",
    );

    expect(report.workflowCount).toBe(1);
    expect(warningFinding?.message).toContain('Job "build_linux"');
    expect(suggestionFinding?.message).toContain('Job "light_tooling"');
  });

  test("does not flag runtime OS package installs when package cache is already visible", async () => {
    const report = await getFixtureReport(fixtures.osPackageInstallOk, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
      ),
    ).toBe(false);
  });

  test("does not flag runtime OS package installs when cache-apt-pkgs-action is already visible", async () => {
    const fixtureRoot = await tempDirs.create("apl-cache-apt-pkgs-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build_linux:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: awalsh128/cache-apt-pkgs-action@v1",
        "        with:",
        "          packages: build-essential clang protobuf-compiler ninja-build",
        "          version: 1.0",
        "      - run: sudo apt-get update && sudo apt-get install -y build-essential clang protobuf-compiler ninja-build",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-caching-os-packages-or-using-a-custom-image",
      ),
    ).toBe(false);
  });

  test("warns when a release-like downstream job uses a status-based if without an explicit success guard", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const guardFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
    );
    const timeoutFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-timeout-minutes",
    );

    expect(report.workflowCount).toBe(1);
    expect(guardFinding?.severity).toBe("warning");
    expect(guardFinding?.message).toContain('job "publish"');
    expect(timeoutFinding?.severity).toBe("warning");
    expect(timeoutFinding?.message).toContain('Job "publish"');
  });

  test("does not flag an ordinary release-like downstream job that relies on default needs behavior", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
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

  test("does not flag a release-like downstream job when the explicit success guard is already present", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-timeout-minutes"),
    ).toBe(false);
  });

  test("downgrades release downstream guards that already block failure and cancellation", async () => {
    const strictReport = await getFixtureReport(fixtures.releaseGuardFailureCancelledLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });
    const exploratoryReport = await getFixtureReport(fixtures.releaseGuardFailureCancelledLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = exploratoryReport.findings.find(
      (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
    );

    expect(
      strictReport.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.score).toBeLessThan(50);
    expect(finding?.why).toContain("already avoids running after upstream failure or cancellation");
    expect(finding?.suggestion).toContain("optional skipped upstream paths");
  });

  test("warns when upload-artifact v4 uploads a compressed file without direct upload", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v4-zip-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: app",
        "          path: dist/app.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("v4");
    expect(finding?.message).toContain("without direct upload support");
    expect(finding?.suggestion).toContain("archive: false");
    expect(finding?.suggestion).toContain("v7");
  });

  test("warns when upload-artifact v7 uploads a compressed file without archive false", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v7-zip-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v7",
        "        with:",
        "          name: app",
        "          path: dist/app.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("v7");
    expect(finding?.message).toContain("without skipping the zip wrapper");
    expect(finding?.suggestion).toContain("archive: false");
  });

  test("does not flag upload-artifact v7 with archive false for a compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-v7-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v7",
        "        with:",
        "          path: dist/app.zip",
        "          archive: false",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for uncompressed file types", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-txt-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          path: dist/app.txt",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for glob paths", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-glob-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v7",
        "        with:",
        "          path: dist/*",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("does not flag upload-artifact for directory paths", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-dir-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v7",
        "        with:",
        "          path: dist/",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
      ),
    ).toBe(false);
  });

  test("warns for single-element array path with a compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-array-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v7",
        "        with:",
        "          path:",
        "            - dist/app.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("dist/app.zip");
  });

  test("warns for ratchet-pinned upload-artifact older than v7 with compressed file", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-ratchet-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # ratchet:actions/upload-artifact@v4",
        "        with:",
        "          path: dist/app.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.suggestion).toContain("v7");
  });

  test("warns for commit-comment upload-artifact v7 without archive false", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-sha-v7-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
        "        with:",
        "          path: dist/app.zip",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-direct-upload-for-compressed-artifacts",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("without skipping the zip wrapper");
  });

  test("warns when upload-artifact uses a broad path without an error guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          path: .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("broad path");
  });

  test("warns when upload-artifact uses a broad path with always-runs guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-always-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        if: success()",
        "        with:",
        "          path: '**'",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  test("does not flag upload-artifact with broad path when failure guard is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-failure-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        if: failure()",
        "        with:",
        "          path: .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("does not flag upload-artifact with broad path when cancelled guard is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-cancelled-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        if: ${{ cancelled() }}",
        "        with:",
        "          path: ./",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("does not flag upload-artifact with a specific path", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-specific-path-ok-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          path: dist/",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-broad-upload-artifact"),
    ).toBe(false);
  });

  test("warns when upload-artifact array contains a broad path without error guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-upload-artifact-broad-array-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          path:",
        "            - dist/",
        "            - '*'",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-broad-upload-artifact",
    );

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("broad path");
  });

  test("warns when a job using yarn/pnpm/bun also upgrades npm globally", async () => {
    const report = await getFixtureReport(fixtures.wastefulNpmGlobalInstallLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "wasteful-npm-global-install",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("yarn");
    expect(finding?.message).toContain("upgrades npm globally");
  });

  test("does not warn when the workflow also calls npm publish", async () => {
    const report = await getFixtureReport(fixtures.wastefulNpmGlobalInstallOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "wasteful-npm-global-install"),
    ).toBe(false);
  });

  test("warns when MySQL/PostgreSQL service containers lack disk I/O optimization", async () => {
    const report = await getFixtureReport(fixtures.dbIoConfigLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter((candidate) => candidate.ruleId === "db-io-reduce");

    expect(report.workflowCount).toBe(1);

    // Service container jobs
    const mysqlService = findings.find((f) => f.message.includes("mysql_service"));
    expect(mysqlService).toBeDefined();
    expect(mysqlService?.message).toContain("MySQL");
    expect(mysqlService?.suggestion).toContain("--tmpfs");

    const postgresService = findings.find((f) => f.message.includes("postgres_service"));
    expect(postgresService).toBeDefined();
    expect(postgresService?.message).toContain("PostgreSQL");
    expect(postgresService?.suggestion).toContain("fsync=off");

    // docker run jobs
    const mysqlDockerRun = findings.find((f) => f.message.includes("mysql_docker_run"));
    expect(mysqlDockerRun).toBeDefined();
    expect(mysqlDockerRun?.message).toContain("docker run");

    const postgresDockerRun = findings.find((f) => f.message.includes("postgres_docker_run"));
    expect(postgresDockerRun).toBeDefined();
    expect(postgresDockerRun?.message).toContain("docker run");
  });

  test("does not warn when MySQL/PostgreSQL services have tmpfs or DB config", async () => {
    const report = await getFixtureReport(fixtures.dbIoConfigOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "db-io-reduce")).toBe(false);
  });
});
