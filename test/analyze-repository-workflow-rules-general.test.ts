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

describe("analyzeRepository workflow and execution rules: general", () => {
  test("finds core MVP findings in a sample repository", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 5,
      mode: "exploratory",
    });

    const ruleIds = report.findings.map((finding) => finding.ruleId);

    expect(report.workflowCount).toBe(2);
    expect(ruleIds).toContain("missing-concurrency");
    expect(ruleIds).toContain("missing-dependency-cache");
    expect(ruleIds).toContain("outdated-setup-action-without-cache");
    expect(ruleIds).toContain("deep-checkout-without-need");
    expect(ruleIds).toContain("missing-path-ignore-for-non-code");
    expect(ruleIds).not.toContain("ungated-heavy-job");
    expect(report.findings[0]?.docsPath).toBe("docs/rules/missing-concurrency.md");
    expect(
      report.findings.find((finding) => finding.ruleId === "missing-concurrency")?.location.line,
    ).toBe(4);
  });

  test("analyzes the dd-trace-js workflow fixture", async () => {
    const report = await getFixtureReport(fixtures.ddTrace, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
    const ungatedCount = report.findings.filter(
      (finding) => finding.ruleId === "ungated-heavy-job",
    ).length;

    expect(report.workflowCount).toBe(27);
    expect(report.findings.length).toBeLessThan(250);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(ruleIds.has("ungated-heavy-job")).toBe(true);
    expect(ungatedCount).toBeLessThan(120);
  });

  test("analyzes the gemini-cli workflow fixture", async () => {
    const report = await getFixtureReport(fixtures.geminiCli, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
    const concurrencyCount = report.findings.filter(
      (finding) => finding.ruleId === "missing-concurrency",
    ).length;
    const deepCheckoutCount = report.findings.filter(
      (finding) => finding.ruleId === "deep-checkout-without-need",
    ).length;

    expect(report.workflowCount).toBe(45);
    expect(report.findings.length).toBeLessThan(80);
    expect(ruleIds.has("missing-paths-filter")).toBe(true);
    expect(ruleIds.has("missing-concurrency")).toBe(true);
    expect(concurrencyCount).toBeLessThan(10);
    expect(deepCheckoutCount).toBeLessThan(10);
  });

  test("adds Actions priority only to the top three Actions findings", async () => {
    const fixtureRoot = await tempDirs.create("apl-limited-actions-priority-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v2",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });
    const scoreByRule = new Map(report.findings.map((finding) => [finding.ruleId, finding.score]));

    expect(scoreByRule.get("missing-concurrency")).toBe(60);
    expect(scoreByRule.get("missing-paths-filter")).toBe(125);
    expect(scoreByRule.get("missing-path-ignore-for-non-code")).toBe(120);
    expect(scoreByRule.get("outdated-setup-action-without-cache")).toBe(115);
  });

  test("accepts a direct workflows directory path", async () => {
    const report = await analyzeRepository({
      cwd: process.cwd(),
      targetPath: path.join(fixtures.geminiCli, ".github", "workflows"),
      topCount: 5,
      mode: "exploratory",
    });

    expect(report.workflowCount).toBe(45);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  test("does not flag schedule-only or tag-only workflows for path filters and branch concurrency", async () => {
    const report = await getFixtureReport(fixtures.iamtrailLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);

    expect(report.workflowCount).toBe(2);
    expect(ruleHits).not.toContain(".github/workflows/policy_validation.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/release.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/release.yml:missing-concurrency");
  });

  test("does not suggest path filters for meta-check workflows", async () => {
    const report = await getFixtureReport(fixtures.metaCheckLike, {
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const ruleHits = report.findings.map((finding) => `${finding.workflow}:${finding.ruleId}`);

    expect(report.workflowCount).toBe(1);
    expect(ruleHits).not.toContain(".github/workflows/lint.yml:missing-paths-filter");
    expect(ruleHits).not.toContain(".github/workflows/lint.yml:missing-path-ignore-for-non-code");
    expect(ruleHits).toContain(".github/workflows/lint.yml:missing-concurrency");
  });

  test("promotes path-filter suggestions in strict mode when no stricter findings exist", async () => {
    const fixtureRoot = await tempDirs.create("apl-strict-path-filter-fallback-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" ||
        candidate.ruleId === "missing-path-ignore-for-non-code",
    );

    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  test("keeps path-filter suggestions exploratory-only when strict findings already exist", async () => {
    const fixtureRoot = await tempDirs.create("apl-strict-path-filter-no-fallback-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: true",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 20",
        "    steps:",
        "      - uses: actions/setup-node@v2",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "outdated-setup-action-without-cache",
      ),
    ).toBe(true);
    expect(report.findings.some((candidate) => candidate.ruleId === "missing-paths-filter")).toBe(
      false,
    );
    expect(
      report.findings.some((candidate) => candidate.ruleId === "missing-path-ignore-for-non-code"),
    ).toBe(false);
  });

  test("adds stacked diff context and priority when Graphite evidence is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-stacked-diff-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, ".graphite"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const concurrencyFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-concurrency",
    );
    const pathsFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-paths-filter",
    );

    expect(concurrencyFinding?.score).toBe(100);
    expect(concurrencyFinding?.why).toContain("stacked diffs");
    expect(concurrencyFinding?.why).toContain(".graphite directory");
    expect(concurrencyFinding?.aiHandoff).toContain("required-check semantics");
    expect(pathsFinding?.score).toBe(130);
    expect(pathsFinding?.why).toContain("stacked diffs");
  });

  test("suggests node --run for simple npm run package scripts with compatibility caveats", async () => {
    const fixtureRoot = await tempDirs.create("apl-node-run-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "node-run-fixture",
        scripts: {
          prelint: "node setup.js",
          lint: "eslint .",
          check: "npm run lint -- --max-warnings=0",
          envcheck: "echo $npm_package_version",
          postlint: "node cleanup.js",
        },
      }),
    );
    await writeFile(
      path.join(fixtureRoot, ".npmrc"),
      "engine-strict=true\nnode-options=--openssl-legacy-provider\nregistry=https://registry.example.com\n",
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "lint.yml"),
      [
        "name: Lint",
        "on: pull_request",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 22",
        "      - run: npm ci",
        "      - run: npm run lint -- --max-warnings=0",
        "        env:",
        "          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-node-run-over-npm-run",
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(
      findings.every(
        (finding) => finding.docsPath === "docs/rules/prefer-node-run-over-npm-run.md",
      ),
    ).toBe(true);

    const workflowFinding = findings.find((finding) => finding.location.path.endsWith("lint.yml"));
    expect(workflowFinding?.message).toContain('"lint"');
    expect(workflowFinding?.suggestion).toBe(
      "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
    );
    expect(workflowFinding?.aiHandoff).toContain("Visible npm-specific compatibility evidence");

    const packageFinding = findings.find((finding) => finding.location.path === "package.json");
    expect(packageFinding?.scope).toBe("repository");
    expect(packageFinding?.message).toContain('script "check"');
    expect(packageFinding?.suggestion).toContain("node --run lint -- --max-warnings=0");
    expect(packageFinding?.suggestion).toContain("prelint/postlint");
    expect(packageFinding?.suggestion).toContain("`node-options`");
    expect(packageFinding?.suggestion).toContain("`registry`");
    expect(packageFinding?.suggestion).toContain('"envcheck"');
  });

  test("adds stacked diff context when GitHub gh-stack evidence is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-gh-stack-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(fixtureRoot, ".github"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "pull_request_template.md"),
      "Stacked PR workflow: use `gh stack submit` after splitting the change.",
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const concurrencyFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-concurrency",
    );

    expect(concurrencyFinding?.score).toBe(100);
    expect(concurrencyFinding?.why).toContain("GitHub gh-stack evidence");
    expect(concurrencyFinding?.why).toContain("pull_request_template.md");
  });

  test("adds stacked diff context when OSS ghstack evidence is present", async () => {
    const fixtureRoot = await tempDirs.create("apl-oss-ghstack-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on:",
        "  pull_request:",
        "    branches-ignore:",
        "      - gh/*/*/base",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm test",
        "  land:",
        "    if: github.event_name == 'workflow_dispatch'",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: ghstack land $PR_URL",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 10,
      mode: "exploratory",
    });

    const concurrencyFinding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-concurrency",
    );

    expect(concurrencyFinding?.score).toBe(100);
    expect(concurrencyFinding?.why).toContain("ghstack evidence");
    expect(concurrencyFinding?.why).toContain("mentions ghstack workflow");
  });

  test("adds similar-job consensus context to missing-dependency-cache", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-cache-consensus-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    const cachedWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 20",
        "          cache: npm",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-a.yml"),
      cachedWorkflow("ci-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-b.yml"),
      cachedWorkflow("ci-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-c.yml"),
      cachedWorkflow("ci-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci-d.yml"),
      [
        "name: ci-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 20",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const cacheFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-dependency-cache" &&
        candidate.workflow === ".github/workflows/ci-d.yml",
    );

    expect(cacheFinding).toBeDefined();
    expect(cacheFinding?.why).toContain("similar jobs already use dependency caching");
    expect(cacheFinding?.why).toContain(".github/workflows/ci-a.yml:test");
  });

  test("adds similar-job consensus context to deep-checkout-without-need", async () => {
    const fixtureRoot = await tempDirs.create("apl-similar-deep-checkout-consensus-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    const shallowWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-a.yml"),
      shallowWorkflow("build-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-b.yml"),
      shallowWorkflow("build-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-c.yml"),
      shallowWorkflow("build-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-d.yml"),
      [
        "name: build-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const checkoutFinding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "deep-checkout-without-need" &&
        candidate.workflow === ".github/workflows/build-d.yml",
    );

    expect(checkoutFinding).toBeDefined();
    expect(checkoutFinding?.why).toContain("similar jobs already avoid full-history checkout");
    expect(checkoutFinding?.why).toContain(".github/workflows/build-a.yml:build");
  });

  test("adds repository precedent context to missing-dependency-cache without consensus", async () => {
    const fixtureRoot = await tempDirs.create("apl-cache-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "cached.yml"),
      [
        "name: cached",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 20",
        "          cache: npm",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "uncached.yml"),
      [
        "name: uncached",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 20",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-dependency-cache" &&
        candidate.workflow === ".github/workflows/uncached.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses dependency caching");
    expect(finding?.why).toContain(".github/workflows/cached.yml:test");
    expect(finding?.why).not.toContain("similar jobs already use dependency caching");
  });

  test("adds repository precedent context to deep-checkout-without-need without consensus", async () => {
    const fixtureRoot = await tempDirs.create("apl-shallow-checkout-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "shallow.yml"),
      [
        "name: shallow",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "deep.yml"),
      [
        "name: deep",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - uses: actions/setup-node@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "deep-checkout-without-need" &&
        candidate.workflow === ".github/workflows/deep.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already keeps checkout shallow");
    expect(finding?.why).toContain(".github/workflows/shallow.yml:build");
    expect(finding?.why).not.toContain("similar jobs already avoid full-history checkout");
  });

  test("adds repository precedent context to missing-paths-filter without consensus", async () => {
    const fixtureRoot = await tempDirs.create("apl-paths-filter-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "scoped.yml"),
      [
        "name: scoped",
        "on:",
        "  pull_request:",
        "    paths:",
        "      - 'src/**'",
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
      path.join(fixtureRoot, ".github", "workflows", "unscoped.yml"),
      [
        "name: unscoped",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" &&
        candidate.workflow === ".github/workflows/unscoped.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses trigger path filters");
    expect(finding?.why).toContain(".github/workflows/scoped.yml");
  });

  test("adds similar-workflow consensus context to missing-paths-filter", async () => {
    const fixtureRoot = await tempDirs.create("apl-paths-filter-consensus-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    const scopedWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "    paths:",
        "      - 'src/**'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-a.yml"),
      scopedWorkflow("build-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-b.yml"),
      scopedWorkflow("build-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-c.yml"),
      scopedWorkflow("build-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "build-d.yml"),
      [
        "name: build-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-paths-filter" &&
        candidate.workflow === ".github/workflows/build-d.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("similar workflows already narrow triggers");
    expect(finding?.why).toContain(".github/workflows/build-a.yml");
  });

  test("adds repository precedent context to outdated-setup-action-without-cache", async () => {
    const fixtureRoot = await tempDirs.create("apl-setup-cache-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "modern.yml"),
      [
        "name: modern",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - run: npm ci",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "legacy.yml"),
      [
        "name: legacy",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v2",
        "      - run: npm ci",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "outdated-setup-action-without-cache" &&
        candidate.workflow === ".github/workflows/legacy.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already uses setup-action cache configuration");
    expect(finding?.why).toContain(".github/workflows/modern.yml:test");
  });

  test("adds repository precedent context to missing-path-ignore-for-non-code without consensus", async () => {
    const fixtureRoot = await tempDirs.create("apl-non-code-ignore-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ignored.yml"),
      [
        "name: ignored",
        "on:",
        "  pull_request:",
        "    paths-ignore:",
        "      - '**/*.md'",
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
      path.join(fixtureRoot, ".github", "workflows", "unignored.yml"),
      [
        "name: unignored",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-path-ignore-for-non-code" &&
        candidate.workflow === ".github/workflows/unignored.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("This repository already ignores obvious non-code changes");
    expect(finding?.why).toContain(".github/workflows/ignored.yml");
  });

  test("adds similar-workflow consensus context to missing-path-ignore-for-non-code", async () => {
    const fixtureRoot = await tempDirs.create("apl-non-code-ignore-consensus-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    const ignoredWorkflow = (name: string) =>
      [
        `name: ${name}`,
        "on:",
        "  pull_request:",
        "    paths-ignore:",
        "      - '**/*.md'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n");

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ignore-a.yml"),
      ignoredWorkflow("ignore-a"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ignore-b.yml"),
      ignoredWorkflow("ignore-b"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ignore-c.yml"),
      ignoredWorkflow("ignore-c"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ignore-d.yml"),
      [
        "name: ignore-d",
        "on:",
        "  pull_request:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-path-ignore-for-non-code" &&
        candidate.workflow === ".github/workflows/ignore-d.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain("similar workflows already ignore obvious non-code changes");
    expect(finding?.why).toContain(".github/workflows/ignore-a.yml");
  });

  test("adds repository precedent context to redundant-manual-cache-with-setup-action", async () => {
    const fixtureRoot = await tempDirs.create("apl-single-cache-strategy-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "simple-cache.yml"),
      [
        "name: simple-cache",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - run: npm ci",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "overlap-cache.yml"),
      [
        "name: overlap-cache",
        "on:",
        "  pull_request:",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - uses: actions/cache@v4",
        "        with:",
        "          path: ~/.npm",
        "          key: npm-cache",
        "      - run: npm ci",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "redundant-manual-cache-with-setup-action" &&
        candidate.workflow === ".github/workflows/overlap-cache.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already relies on setup-action cache without overlapping manual cache",
    );
    expect(finding?.why).toContain(".github/workflows/simple-cache.yml:test");
  });

  test("flags elixir with outdated OTP (25) and Elixir (1.14) in setup-beam", async () => {
    const report = await getFixtureReport(fixtures.elixirSecurityAdvisoriesOk, {
      targetPath: ".",
      topCount: 50,
      mode: "exploratory",
    });

    const elixirFindings = report.findings.filter(
      (f) => f.ruleId === "elixir-otp-version-performance",
    );

    const otp25Findings = elixirFindings.filter((f) => f.message.includes("OTP 25"));
    const elixir14Findings = elixirFindings.filter((f) => f.message.includes("Elixir 1.14"));

    expect(otp25Findings.length).toBeGreaterThanOrEqual(1);
    expect(elixir14Findings.length).toBeGreaterThanOrEqual(1);
  });
});
