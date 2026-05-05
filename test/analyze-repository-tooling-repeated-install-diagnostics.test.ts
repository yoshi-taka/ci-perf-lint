import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository repo-aware and tooling rules: repeated install diagnostics", () => {
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
});
