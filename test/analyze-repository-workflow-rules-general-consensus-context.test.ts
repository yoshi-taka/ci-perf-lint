import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTempDirTracker, getWorkflowFocusedFixtureReport } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: consensus and precedent context", () => {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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

    const report = await getWorkflowFocusedFixtureReport(fixtureRoot, {
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
});
