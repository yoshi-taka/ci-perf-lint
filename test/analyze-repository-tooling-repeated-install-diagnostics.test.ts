import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const workflows: Record<string, string> = {
  "repeated-install": [
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
  "repeated-pnpm": [
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
  "single-install-ok": [
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
  "reusable-ok": [
    "name: CI",
    "on: push",
    "jobs:",
    "  build:",
    "    uses: ./.github/workflows/reusable-build.yml",
  ].join("\n"),
  "mixed-install": [
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
  "lockfile-only-ok": [
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
  "frozen-then-plain-ok": [
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
  "npm-lockfile-install-ok": [
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
  "diff-wd-install-ok": [
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
  "global-pkg-diff-ok": [
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
  "global-pkg-same": [
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
  "pnpm-ignore-workspace-ok": [
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
};

describe("analyzeRepository repo-aware and tooling rules: repeated install diagnostics", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;

  beforeAll(async () => {
    const fixtureRoot = await tempDirs.create("apl-repeated-install-batch-");
    const wfDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(wfDir, { recursive: true });

    await Promise.all(
      Object.entries(workflows).map(([name, content]) =>
        writeFile(path.join(wfDir, `${name}.yml`), content),
      ),
    );

    report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 50,
      mode: "strict",
    });
  });

  function findings(name: string, ruleId: string) {
    return report.findings.filter(
      (f) => f.workflow === `.github/workflows/${name}.yml` && f.ruleId === ruleId,
    );
  }

  function hasFinding(name: string, ruleId: string): boolean {
    return report.findings.some(
      (f) => f.workflow === `.github/workflows/${name}.yml` && f.ruleId === ruleId,
    );
  }

  test("flags repeated install commands within the same job", () => {
    const f = findings("repeated-install", "repeated-install-in-same-job");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("warning");
    expect(f[0]!.message).toContain('Job "build"');
    expect(f[0]!.message).toContain("npm install 2 times");
  });

  test("flags repeated pnpm install commands within the same job", () => {
    const f = findings("repeated-pnpm", "repeated-install-in-same-job");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("pnpm install 2 times");
  });

  test("does not flag when install runs only once in a job", () => {
    expect(hasFinding("single-install-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("does not flag repeated installs in reusable workflow jobs", () => {
    expect(hasFinding("reusable-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("flags repeated install via different managers separately", () => {
    const f = findings("mixed-install", "repeated-install-in-same-job");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("pip install 3 times");
  });

  test("does not flag bun install with lockfile-only as repeated install", () => {
    expect(hasFinding("lockfile-only-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("does not flag frozen lockfile install followed by plain install (upgrade workflow pattern)", () => {
    expect(hasFinding("frozen-then-plain-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("does not flag npm install with package-lock-only as repeated install", () => {
    expect(hasFinding("npm-lockfile-install-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("does not flag repeated install with different working-directory", () => {
    expect(hasFinding("diff-wd-install-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("does not flag npm install -g of different packages as duplicate", () => {
    expect(hasFinding("global-pkg-diff-ok", "repeated-install-in-same-job")).toBe(false);
  });

  test("flags npm install -g of the same package twice", () => {
    const f = findings("global-pkg-same", "repeated-install-in-same-job");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("npm install 2 times");
  });

  test("does not flag pnpm install with --ignore-workspace as duplicate of workspace install", () => {
    expect(hasFinding("pnpm-ignore-workspace-ok", "repeated-install-in-same-job")).toBe(false);
  });
});
