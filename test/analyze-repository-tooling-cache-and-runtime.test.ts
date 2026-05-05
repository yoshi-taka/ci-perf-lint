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

describe("analyzeRepository repo-aware and tooling rules: cache and runtime", () => {
  test("finds duplicated lint and npx bootstrap patterns", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.duplicationLike,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);

    expect(report.workflowCount).toBe(1);
    expect(ruleHits).toContain(".github/workflows/ci.yml:redundant-npx-or-bootstrap");
    expect(ruleHits).toContain(".github/workflows/ci.yml:repeated-lint-in-same-workflow");
    expect(ruleHits).toContain(".github/workflows/ci.yml:duplicate-install-or-lint");
  });

  test("does not flag repeated lint or duplicate install-lint patterns for matrix jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-matrix-lint-skip-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
        "    strategy:",
        "      matrix:",
        "        package: [app, docs]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx eslint .",
        "  lint_more:",
        "    strategy:",
        "      matrix:",
        "        package: [app, docs]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx eslint .",
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
        (finding) =>
          finding.ruleId === "repeated-lint-in-same-workflow" ||
          finding.ruleId === "duplicate-install-or-lint",
      ),
    ).toBe(false);
  });

  test("does not flag duplicate install-lint patterns for meta-check workflows", async () => {
    const fixtureRoot = await tempDirs.create("apl-meta-lint-skip-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: Meta checks",
        "on: pull_request",
        "jobs:",
        "  lint_actions:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx actionlint",
        "  lint_policy:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx actionlint",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((finding) => finding.ruleId === "duplicate-install-or-lint")).toBe(
      false,
    );
  });

  test("flags missing cache when e18e/action-dependency-diff runs npm ci internally", async () => {
    const fixtureRoot = await tempDirs.create("apl-action-dep-diff-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "main.yml"),
      [
        "name: Main",
        "on: pull_request",
        "jobs:",
        "  dep-review:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 20",
        "      - uses: e18e/action-dependency-diff@v1",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const cacheFinding = report.findings.find((f) => f.ruleId === "missing-dependency-cache");
    expect(cacheFinding).toBeDefined();
    expect(cacheFinding?.message).toContain("actions/setup-node@v4");
    expect(cacheFinding?.message).toContain('job "dep-review"');
  });

  test("understands built-in and manual dependency cache coverage across official setup actions", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.dependencyCacheLike,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);
    const workflowHits = new Set(report.findings.map((finding) => finding.workflow));
    const dependencyCacheFindings = report.findings.filter(
      (finding) => finding.ruleId === "missing-dependency-cache",
    );

    expect(report.workflowCount).toBe(1);
    expect(ruleHits).toContain(".github/workflows/cache.yml:missing-dependency-cache");
    expect(dependencyCacheFindings).toHaveLength(3);
    expect(dependencyCacheFindings.every((finding) => finding.severity === "suggestion")).toBe(
      true,
    );
    expect(workflowHits.has(".github/workflows/cache.yml")).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-dependency-cache" &&
          finding.message.includes('job "node_auto_cache"'),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-dependency-cache" &&
          finding.message.includes('job "go_default_cache"'),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-dependency-cache" &&
          finding.message.includes('job "python_manual_cache"'),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "missing-dependency-cache" &&
          finding.message.includes('job "ruby_builtin_cache"'),
      ),
    ).toBe(false);
    expect(
      report.findings.some((finding) => finding.message.includes('job "python_missing"')),
    ).toBe(true);
    expect(report.findings.some((finding) => finding.message.includes('job "java_missing"'))).toBe(
      true,
    );
    expect(
      report.findings.some((finding) => finding.message.includes('job "dotnet_missing"')),
    ).toBe(true);
  });

  test("flags shard-like matrix tests when the matrix value is not consumed by the test runner", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.matrixShardLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "matrix-test-job-without-test-sharding",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("shard-like matrix keys");
    expect(finding?.suggestion).toContain("jest --shard");
  });

  test("does not flag shard-like matrix tests when the runner consumes the matrix value", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.matrixShardOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "matrix-test-job-without-test-sharding",
      ),
    ).toBe(false);
  });

  test("suggests explicit worker tuning for direct test tools on standard runners", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.workerTuningLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-test-worker-tuning-for-standard-runner",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain('Job "jest_default"');
    expect(finding?.suggestion).toContain("--maxWorkers");
    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "missing-test-worker-tuning-for-standard-runner" &&
          candidate.message.includes("self_hosted_skip"),
      ),
    ).toBe(false);
  });

  test("does not flag direct test tools when worker tuning is already visible", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.workerTuningOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-test-worker-tuning-for-standard-runner",
      ),
    ).toBe(false);
  });

  test("suggests checking logs when native-heavy packages overlap with source-build smells", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.nativeBuildRiskLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "native-dependency-may-fall-back-to-source-build",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.why).toContain("sharp");
    expect(finding?.why).toContain("esbuild");
    expect(finding?.why).toContain("optional dependency bypass");
  });

  test("does not flag native-heavy packages without visible source-build smells", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.nativeBuildRiskOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "native-dependency-may-fall-back-to-source-build",
      ),
    ).toBe(false);
  });

  describe("build cache warnings", () => {
    const defaultOptions = { targetPath: ".", topCount: 20, mode: "strict" as const };

    type BuildCacheCase = {
      name: string;
      fixture: string;
      ruleId: string;
      message?: string;
      expectAbsent?: boolean;
    };

    const buildCacheCases: BuildCacheCase[] = [
      { name: "Next.js: warns when .next/cache is not persisted", fixture: fixtures.nextCacheLike, ruleId: "missing-next-build-cache", message: ".next/cache" },
      { name: "Next.js: does not warn when .next/cache is persisted", fixture: fixtures.nextCacheOk, ruleId: "missing-next-build-cache", expectAbsent: true as const },
      { name: "Turbo: warns when cache is not wired", fixture: fixtures.turboCacheLike, ruleId: "missing-turbo-cache", message: "Turbo tasks" },
      { name: "Turbo: does not warn when cache is wired", fixture: fixtures.turboCacheOk, ruleId: "missing-turbo-cache", expectAbsent: true as const },
      { name: "Gradle: warns when build cache is not configured", fixture: fixtures.gradleCacheLike, ruleId: "missing-gradle-build-cache", message: "Gradle tasks" },
      { name: "Gradle: does not warn when build cache is configured", fixture: fixtures.gradleCacheOk, ruleId: "missing-gradle-build-cache", expectAbsent: true as const },
      { name: "Angular CLI: warns when cache is not wired for CI", fixture: fixtures.angularCacheLike, ruleId: "missing-angular-cli-cache", message: "Angular CLI" },
      { name: "Angular CLI: does not warn when cache is wired", fixture: fixtures.angularCacheOk, ruleId: "missing-angular-cli-cache", expectAbsent: true },
    ];

    test.each(buildCacheCases.map((tc) => [tc.name, tc] as const))(
      "%s",
      async (_name, tc) => {
        const report = await getFixtureReport(tc.fixture, defaultOptions);

        if (tc.expectAbsent) {
          expect(report.findings.some((f) => f.ruleId === tc.ruleId)).toBe(false);
        } else {
          const finding = report.findings.find((f) => f.ruleId === tc.ruleId);
          expect(finding).toBeDefined();
          expect(finding!.severity).toBe("warning");
          expect(finding!.message).toContain(tc.message!);
          expect(report.workflowCount).toBe(1);
        }
      },
    );
  });

  describe("terraform rules", () => {
    type TerraformCase = {
      name: string;
      fixture: string;
      ruleId: string;
      mode: "strict" | "exploratory";
      severity?: "error" | "warning" | "suggestion";
      confidence?: "high" | "medium";
      locationPath?: string;
      message?: string;
      count?: number;
      expectAbsent?: boolean;
    };

    const terraformCases: TerraformCase[] = [
      { name: "flags terraform init jobs missing provider caching", fixture: fixtures.terraformCacheLike, ruleId: "cache-terraform-providers", mode: "exploratory", severity: "warning", message: "terraform init", count: 1 },
      { name: "does not flag terraform init jobs with provider caching", fixture: fixtures.terraformCacheOk, ruleId: "cache-terraform-providers", mode: "exploratory" as const, expectAbsent: true as const },
      { name: "flags missing terraform lock file", fixture: fixtures.terraformLockfileMissing, ruleId: "terraform-lockfile-missing", mode: "strict" as const, severity: "warning" as const, message: ".terraform.lock.hcl", count: 1 },
      { name: "does not flag missing lock file when lock file exists", fixture: fixtures.terraformLockfileOk, ruleId: "terraform-lockfile-missing", mode: "strict" as const, expectAbsent: true as const },
      { name: "flags repo-wide when no --parallelism in any terraform workflow", fixture: fixtures.terraformParallelismMissing, ruleId: "terraform-parallelism-unconfigured", mode: "exploratory" as const, severity: "suggestion" as const, message: "--parallelism", count: 1 },
      { name: "does not flag when --parallelism is in command text", fixture: fixtures.terraformParallelismOk, ruleId: "terraform-parallelism-unconfigured", mode: "exploratory" as const, expectAbsent: true as const },
      { name: "does not flag when TF_CLI_ARGS env var sets parallelism", fixture: fixtures.terraformParallelismOkEnv, ruleId: "terraform-parallelism-unconfigured", mode: "exploratory" as const, expectAbsent: true as const },
      { name: "flags provider github blocks without app_auth", fixture: fixtures.terraformGitHubAppAuthLike, ruleId: "terraform-github-app-auth", mode: "exploratory" as const, severity: "suggestion" as const, confidence: "high" as const, locationPath: "main.tf", message: "app_auth", count: 2 },
      { name: "does not flag when app_auth is present", fixture: fixtures.terraformGitHubAppAuthOk, ruleId: "terraform-github-app-auth", mode: "exploratory" as const, expectAbsent: true as const },
      { name: "flags GHE provider without parallel_requests", fixture: fixtures.terraformGitHubParallelRequestsLike, ruleId: "terraform-github-parallel-requests", mode: "exploratory" as const, severity: "suggestion" as const, confidence: "high" as const, locationPath: "main.tf", message: "parallel_requests", count: 2 },
      { name: "does not flag GHE provider with parallel_requests enabled", fixture: fixtures.terraformGitHubParallelRequestsOk, ruleId: "terraform-github-parallel-requests", mode: "exploratory" as const, expectAbsent: true as const },
      { name: "flags resources with unnecessary data.github_repository lookups", fixture: fixtures.terraformGitHubSlowResourcesLike, ruleId: "terraform-github-slow-resources", mode: "strict" as const, severity: "warning" as const, confidence: "high" as const, locationPath: "main.tf", message: "data.github_repository", count: 3 },
      { name: "does not flag when resources use direct attributes", fixture: fixtures.terraformGitHubSlowResourcesOk, ruleId: "terraform-github-slow-resources", mode: "strict" as const, expectAbsent: true as const },
      { name: "flags pagerduty_team_membership with provider below v3.32.2", fixture: fixtures.terraformPagerDutyTeamMembershipVersionLike, ruleId: "terraform-pagerduty-team-membership-version", mode: "strict" as const, severity: "warning" as const, confidence: "high" as const, locationPath: "main.tf", message: "PagerDuty", count: 2 },
      { name: "does not flag pagerduty_team_membership with provider >= 3.32.2", fixture: fixtures.terraformPagerDutyTeamMembershipVersionOk, ruleId: "terraform-pagerduty-team-membership-version", mode: "strict" as const, expectAbsent: true },
    ];

    test.each(terraformCases.map((tc) => [tc.name, tc] as const))(
      "%s",
      async (_name, tc) => {
        const report = await getFixtureReport(tc.fixture, {
          targetPath: ".",
          topCount: 20,
          mode: tc.mode,
        });

        if (tc.expectAbsent) {
          expect(report.findings.some((f) => f.ruleId === tc.ruleId)).toBe(false);
          return;
        }

        const findings = report.findings.filter((f) => f.ruleId === tc.ruleId);

        if (tc.count !== undefined) {
          expect(findings).toHaveLength(tc.count);
        }

        for (const finding of findings) {
          expect(finding.severity).toBe(tc.severity!);
          if (tc.confidence) {
            expect(finding.confidence).toBe(tc.confidence);
          }
          if (tc.locationPath) {
            expect(finding.location.path).toBe(tc.locationPath);
          }
          if (tc.message) {
            expect(finding.message).toContain(tc.message);
          }
        }
      },
    );
  });


});
