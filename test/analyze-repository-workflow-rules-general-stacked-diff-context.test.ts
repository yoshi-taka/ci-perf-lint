import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository workflow and execution rules: stacked diff context", () => {
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

    expect(concurrencyFinding?.score).toBe(98);
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

    expect(concurrencyFinding?.score).toBe(98);
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

    expect(concurrencyFinding?.score).toBe(98);
    expect(concurrencyFinding?.why).toContain("ghstack evidence");
    expect(concurrencyFinding?.why).toContain("mentions ghstack workflow");
  });
});
