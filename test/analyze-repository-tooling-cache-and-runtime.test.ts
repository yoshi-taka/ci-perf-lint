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

  test("warns when Next.js builds run without a visible .next/cache strategy", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.nextCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-next-build-cache",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain(".next/cache");
  });

  test("does not flag Next.js builds when .next/cache is visibly persisted", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.nextCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-next-build-cache"),
    ).toBe(false);
  });

  test("warns when Turbo tasks run without visible local or remote cache wiring", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.turboCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find((candidate) => candidate.ruleId === "missing-turbo-cache");

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Turbo tasks");
  });

  test("does not flag Turbo tasks when local cache or remote cache wiring is visible", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.turboCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "missing-turbo-cache")).toBe(
      false,
    );
  });

  test("warns when Gradle tasks run without visible repository build cache configuration", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.gradleCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-gradle-build-cache",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Gradle tasks");
  });

  test("does not flag Gradle tasks when repository build cache configuration is visible", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.gradleCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-gradle-build-cache"),
    ).toBe(false);
  });

  test("warns when Angular CLI cache is not fully wired for CI", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.angularCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-angular-cli-cache",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Angular CLI");
  });

  test("does not flag Angular CLI tasks when cache is enabled for CI and visibly persisted", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.angularCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-angular-cli-cache"),
    ).toBe(false);
  });

  test("flags terraform init jobs missing provider caching", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformCacheLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "cache-terraform-providers",
    );

    expect(report.workflowCount).toBe(1);
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.severity).toBe("warning");
    expect(finding.message).toContain("terraform_plan");
    expect(finding.message).toContain("terraform init");
  });

  test("does not flag terraform init jobs with provider caching", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformCacheOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "cache-terraform-providers"),
    ).toBe(false);
  });

  test("flags missing terraform lock file when terraform init is used", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformLockfileMissing,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-lockfile-missing",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain(".terraform.lock.hcl");
    expect(findings[0]!.message).toContain("terraform init");
  });

  test("does not flag missing lock file when lock file exists", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformLockfileOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "terraform-lockfile-missing"),
    ).toBe(false);
  });

  test("flags repo-wide when no --parallelism found in any terraform workflow", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformParallelismMissing,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-parallelism-unconfigured",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("suggestion");
    expect(findings[0]!.message).toContain("--parallelism");
    expect(findings[0]!.message).toContain("TF_CLI_ARGS");
  });

  test("does not flag when --parallelism is in command text", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformParallelismOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "terraform-parallelism-unconfigured",
      ),
    ).toBe(false);
  });

  test("does not flag when TF_CLI_ARGS env var sets parallelism", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformParallelismOkEnv,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "terraform-parallelism-unconfigured",
      ),
    ).toBe(false);
  });

  test("flags provider github blocks without app_auth", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubAppAuthLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-github-app-auth",
    );

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.severity).toBe("suggestion");
      expect(finding.confidence).toBe("high");
      expect(finding.location.path).toBe("main.tf");
      expect(finding.message).toContain("app_auth");
    }
  });

  test("does not flag when app_auth is present", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubAppAuthOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "terraform-github-app-auth"),
    ).toBe(false);
  });

  test("flags GHE provider without parallel_requests", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubParallelRequestsLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-github-parallel-requests",
    );

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.severity).toBe("suggestion");
      expect(finding.confidence).toBe("high");
      expect(finding.location.path).toBe("main.tf");
      expect(finding.message).toContain("parallel_requests");
    }
  });

  test("does not flag GHE provider with parallel_requests enabled", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubParallelRequestsOk,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "terraform-github-parallel-requests",
      ),
    ).toBe(false);
  });

  test("flags resources with unnecessary data.github_repository lookups", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubSlowResourcesLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-github-slow-resources",
    );

    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(finding.severity).toBe("warning");
      expect(finding.confidence).toBe("high");
      expect(finding.location.path).toBe("main.tf");
      expect(finding.message).toContain("data.github_repository");
    }
  });

  test("does not flag when resources use direct attributes instead of data lookups", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformGitHubSlowResourcesOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "terraform-github-slow-resources"),
    ).toBe(false);
  });

  test("flags pagerduty_team_membership with provider below v3.32.2", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformPagerDutyTeamMembershipVersionLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "terraform-pagerduty-team-membership-version",
    );

    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.severity).toBe("warning");
      expect(finding.confidence).toBe("high");
      expect(finding.location.path).toBe("main.tf");
      expect(finding.message).toContain("PagerDuty");
    }
  });

  test("does not flag pagerduty_team_membership with provider >= 3.32.2", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.terraformPagerDutyTeamMembershipVersionOk,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "terraform-pagerduty-team-membership-version",
      ),
    ).toBe(false);
  });

  test("flags repeated install commands within the same job", async () => {
    const fixtureRoot = await tempDirs.create("apl-repeated-install-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "repeated-install-in-same-job",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain('Job "build"');
    expect(findings[0]!.message).toContain("npm install 2 times");
  });

  test("flags repeated pnpm install commands within the same job", async () => {
    const fixtureRoot = await tempDirs.create("apl-repeated-pnpm-install-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm install",
        "      - run: pnpm lint",
        "      - run: pnpm install",
        "      - run: pnpm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "repeated-install-in-same-job",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("pnpm install 2 times");
  });

  test("does not flag when install runs only once in a job", async () => {
    const fixtureRoot = await tempDirs.create("apl-single-install-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("does not flag repeated installs in reusable workflow jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-reusable-install-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    uses: ./.github/workflows/reusable-build.yml",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("flags repeated install via different managers separately", async () => {
    const fixtureRoot = await tempDirs.create("apl-mixed-install-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pip install -r requirements.txt",
        "      - run: pip install -r requirements-dev.txt",
        "      - run: pip install -e .",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "repeated-install-in-same-job",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("pip install 3 times");
  });

  test("does not flag bun install with lockfile-only as repeated install", async () => {
    const fixtureRoot = await tempDirs.create("apl-lockfile-only-install-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  finalize:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: bun install --frozen-lockfile",
        "      - run: bun run some-script.ts",
        "      - run: bun install --lockfile-only --ignore-scripts",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("does not flag frozen lockfile install followed by plain install (upgrade workflow pattern)", async () => {
    const fixtureRoot = await tempDirs.create("apl-frozen-then-plain-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: Upgrade",
        "on: schedule",
        "jobs:",
        "  upgrade:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: yarn install --frozen-lockfile",
        "      - run: ncu -u",
        "      - run: yarn install",
        "      - run: yarn upgrade",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("does not flag npm install with package-lock-only as repeated install", async () => {
    const fixtureRoot = await tempDirs.create("apl-npm-lockfile-install-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  finalize:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run some-script.ts",
        "      - run: npm install --package-lock-only",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("does not flag repeated install with different working-directory", async () => {
    const fixtureRoot = await tempDirs.create("apl-diff-wd-install-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  benchmark:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm install --frozen-lockfile",
        "        working-directory: head",
        "      - run: pnpm build",
        "        working-directory: head",
        "      - run: pnpm install --frozen-lockfile",
        "        working-directory: base",
        "      - run: pnpm build",
        "        working-directory: base",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("does not flag npm install -g of different packages as duplicate", async () => {
    const fixtureRoot = await tempDirs.create("apl-global-pkg-diff-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm install -g verdaccio --registry http://localhost",
        "      - run: npm install -g gatsby-cli --registry http://localhost",
        "      - run: npm install -g @angular/cli --registry http://localhost",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("flags npm install -g of the same package twice", async () => {
    const fixtureRoot = await tempDirs.create("apl-global-pkg-same-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm install -g verdaccio --registry http://localhost",
        "      - run: npm install -g verdaccio --registry http://other-registry",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "repeated-install-in-same-job",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("npm install 2 times");
  });

  test("does not flag pnpm install with --ignore-workspace as duplicate of workspace install", async () => {
    const fixtureRoot = await tempDirs.create("apl-pnpm-ignore-workspace-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: Validate Stats",
        "on: push",
        "jobs:",
        "  validate:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm install --frozen-lockfile",
        "      - run: |",
        "          for PKG in packages/starter-* packages/app-*; do",
        '            (cd "$PKG" && pnpm install --frozen-lockfile --ignore-workspace)',
        "          done",
        "      - run: pnpm --filter @framework-tracker/stats-generator run:ssr $PKG",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "repeated-install-in-same-job"),
    ).toBe(false);
  });

  test("flags lint-only job that unnecessarily installs app dependencies", async () => {
    const fixtureRoot = await tempDirs.create("apl-unnecessary-install-lint-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
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
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
    expect(findings[0]!.message).toContain('Job "lint"');
  });

  test("does not flag when lint job also builds", async () => {
    const fixtureRoot = await tempDirs.create("apl-lint-and-build-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run lint",
        "      - run: npm run build",
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
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });

  test("does not flag job without install even if lint-only", async () => {
    const fixtureRoot = await tempDirs.create("apl-no-install-lint-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npx eslint .",
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
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });

  test("does not flag lint-only job when pnpm install is followed by test", async () => {
    const fixtureRoot = await tempDirs.create("apl-install-test-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: pnpm install",
        "      - run: pnpm test",
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
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });

  test("does not flag lint-only job in reusable workflow", async () => {
    const fixtureRoot = await tempDirs.create("apl-reusable-lint-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
        "    uses: ./.github/workflows/reusable-lint.yml",
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
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });

  test("does not flag eslint job when eslint config exists", async () => {
    const fixtureRoot = await tempDirs.create("apl-eslint-config-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx eslint .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".eslintrc.json"),
      JSON.stringify({ extends: ["eslint:recommended"] }),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });

  test("does not flag prettier job when prettier plugins are used", async () => {
    const fixtureRoot = await tempDirs.create("apl-prettier-plugin-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  format:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npx prettier --check .",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "test",
        devDependencies: { "prettier-plugin-tailwindcss": "^0.7.0" },
      }),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "unnecessary-app-install-for-lint-job",
      ),
    ).toBe(false);
  });
});
