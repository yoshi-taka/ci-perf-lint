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

describe("analyzeRepository workflow and execution rules: heavy jobs and release guards", () => {
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

    const mysqlService = findings.find((f) => f.message.includes("mysql_service"));
    expect(mysqlService).toBeDefined();
    expect(mysqlService?.message).toContain("MySQL");
    expect(mysqlService?.suggestion).toContain("--tmpfs");

    const postgresService = findings.find((f) => f.message.includes("postgres_service"));
    expect(postgresService).toBeDefined();
    expect(postgresService?.message).toContain("PostgreSQL");
    expect(postgresService?.suggestion).toContain("fsync=off");

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
