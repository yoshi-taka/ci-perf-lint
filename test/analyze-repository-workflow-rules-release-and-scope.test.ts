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

  test("warns when a history-aware release job looks narrow enough for sparse checkout", async () => {
    const report = await getFixtureReport(fixtures.sparseCheckoutLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('Job "publish" appears to keep history available');
    expect(finding?.why).toContain('"packages/opencode"');
    expect(finding?.suggestion).toContain("Keep fetch-depth: 0");
  });

  test("uses softer sparse-checkout wording when git-sensitive flow is visible without explicit full-history signals", async () => {
    const fixtureRoot = await tempDirs.create("apl-sparse-checkout-soft-history-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "release.yml"),
      [
        "name: release",
        "on: workflow_dispatch",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: git checkout -b release-branch",
        "      - run: git commit --allow-empty -m release",
        "      - run: git push --set-upstream origin release-branch",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: cli",
        "          path: packages/opencode/dist/*",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("uses only a narrow working tree");
    expect(finding?.message).not.toContain("full history");
    expect(finding?.why).toContain("full-history requirement is not visible");
  });

  test("downgrades sparse-checkout guidance for multi-checkout jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-sparse-checkout-multi-checkout-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "release.yml"),
      [
        "name: release",
        "on: workflow_dispatch",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: .github/scripts/use-cla-approved-bot.sh",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          ref: cloudfoundry",
        "      - run: git checkout -b cloudfoundry-update",
        "      - run: git push --set-upstream origin cloudfoundry-update",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
    );

    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("multiple checkouts");
    expect(finding?.why).toContain("manual review");
  });

  test("does not flag sparse checkout for opaque repo scripts even when local actions add visible scope", async () => {
    const report = await getFixtureReport(fixtures.sparseCheckoutOpaqueScriptWithLocalAction, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag sparse checkout for local-action-driven changeset validation jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-sparse-checkout-local-action-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, ".github", "actions", "install-app-node"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixtureRoot, ".github", "actions", "install-app-node", "action.yml"),
      "name: install\nruns:\n  using: composite\n  steps:\n    - run: echo install\n      shell: bash\n",
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  changeset-validation:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: ./.github/actions/install-app-node",
        "      - run: pnpm ci:version:changeset",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag sparse checkout for agentic docs jobs that inspect recent code changes", async () => {
    const report = await getFixtureReport(fixtures.sparseCheckoutAgenticDocsUpdate, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag scoped history-aware jobs when sparse checkout is already configured", async () => {
    const report = await getFixtureReport(fixtures.sparseCheckoutOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag monorepo-style release preflight jobs that visibly need a broad working tree", async () => {
    const report = await getFixtureReport(fixtures.sparseCheckoutPreflightFalsePositive, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("adds repository precedent context to prefer-sparse-checkout-for-scoped-workflow", async () => {
    const fixtureRoot = await tempDirs.create("apl-sparse-checkout-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "sparse.yml"),
      [
        "name: sparse",
        "on:",
        "  push:",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "          sparse-checkout: |",
        "            packages/opencode",
        "      - run: git log --oneline -1",
        "      - run: git describe --tags --always > packages/opencode/dist/version.txt",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: cli",
        "          path: packages/opencode/dist/*",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "full.yml"),
      [
        "name: full",
        "on:",
        "  push:",
        "jobs:",
        "  publish:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - run: git log --oneline -1",
        "      - run: git describe --tags --always > packages/opencode/dist/version.txt",
        "      - uses: actions/upload-artifact@v4",
        "        with:",
        "          name: cli",
        "          path: packages/opencode/dist/*",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow" &&
        candidate.workflow === ".github/workflows/full.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already uses sparse-checkout for scoped history-aware jobs",
    );
    expect(finding?.why).toContain(".github/workflows/sparse.yml:publish");
  });

  test("warns when a release metadata job could likely use checkout filter blob:none", async () => {
    const report = await getFixtureReport(fixtures.blobNoneLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('Job "notes"');
    expect(finding?.suggestion).toContain("filter: blob:none");
    expect(finding?.why).toContain("release metadata");
  });

  test("warns when a gh release job uses full history without checkout filter blob:none", async () => {
    const report = await getFixtureReport(fixtures.blobNoneGhReleaseLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.message).toContain('Job "github_release"');
    expect(finding?.suggestion).toContain("filter: blob:none");
  });

  test("warns when a changelog action uses full history without checkout filter blob:none", async () => {
    const report = await getFixtureReport(fixtures.blobNoneChangelogActionLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.message).toContain('Job "notes"');
    expect(finding?.suggestion).toContain("filter: blob:none");
  });

  test("does not suggest blob:none for release jobs that visibly build and publish packages", async () => {
    const report = await getFixtureReport(fixtures.blobNoneHeavyPublishLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
      ),
    ).toBe(false);
  });

  test("does not suggest blob:none for local-action-driven changeset validation jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-blob-none-local-action-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, ".github", "actions", "install-app-node"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixtureRoot, ".github", "actions", "install-app-node", "action.yml"),
      "name: install\nruns:\n  using: composite\n  steps:\n    - run: echo install\n      shell: bash\n",
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: pull_request",
        "jobs:",
        "  changeset-validation:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: ./.github/actions/install-app-node",
        "      - run: git rev-list --count HEAD",
        "      - run: pnpm changeset version",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
      ),
    ).toBe(false);
  });

  test("keeps blob:none guidance for prepare release jobs with explicit depth fetches", async () => {
    const report = await getFixtureReport(fixtures.blobNonePrepareFetchLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
    );

    expect(finding?.message).toContain('Job "prepare"');
    expect(finding?.suggestion).toContain("git fetch --depth");
    expect(finding?.suggestion).toContain("--filter=blob:none");
    expect(finding?.measurementHint).toContain("explicit git fetch duration");
  });

  test("does not suggest blob:none for agentic docs jobs that edit repository files", async () => {
    const report = await getFixtureReport(fixtures.blobNoneAgenticDocsEditLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
      ),
    ).toBe(false);
  });

  test("treats missing concurrency and timeout as warnings for agentic PR workflows", async () => {
    const report = await getFixtureReport(fixtures.agenticWorkflowLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const concurrencyFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-concurrency",
    );
    const timeoutFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-timeout-minutes",
    );

    expect(report.workflowCount).toBe(1);
    expect(concurrencyFinding?.severity).toBe("warning");
    expect(concurrencyFinding?.why).toContain("AI-assisted");
    expect(timeoutFinding?.severity).toBe("warning");
    expect(timeoutFinding?.why).toContain("AI-assisted job");
  });

  test("does not flag statically disabled agentic jobs for timeout or sparse checkout", async () => {
    const report = await getFixtureReport(fixtures.disabledAgenticWorkflow, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-timeout-minutes"),
    ).toBe(false);
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-sparse-checkout-for-scoped-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag release metadata jobs when checkout filter blob:none is already configured", async () => {
    const report = await getFixtureReport(fixtures.blobNoneOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "consider-filter-blob-none-for-release-metadata",
      ),
    ).toBe(false);
  });

  test("adds repository precedent context to consider-filter-blob-none-for-release-metadata", async () => {
    const fixtureRoot = await tempDirs.create("apl-blob-none-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "blob-none.yml"),
      [
        "name: blob-none",
        "on:",
        "  push:",
        "jobs:",
        "  notes:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "          filter: blob:none",
        "      - run: git log --oneline",
        "      - run: gh release view v1.2.3 --json body",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "full-blobs.yml"),
      [
        "name: full-blobs",
        "on:",
        "  push:",
        "jobs:",
        "  notes:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - run: git log --oneline",
        "      - run: gh release view v1.2.3 --json body",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "consider-filter-blob-none-for-release-metadata" &&
        candidate.workflow === ".github/workflows/full-blobs.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already uses checkout `filter: blob:none` for release metadata jobs",
    );
    expect(finding?.why).toContain(".github/workflows/blob-none.yml:notes");
  });

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
