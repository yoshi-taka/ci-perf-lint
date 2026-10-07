import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("analyzeRepository repo-aware and tooling rules: migrations and platform guidance (generated fixtures)", () => {
  test("recommends Jest 30 from Jest 29 when TypeScript and JSDOM are compatible", async () => {
    const fixtureRoot = await tempDirs.create("apl-jest-30-like-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "jest-30-like",
        scripts: {
          test: "jest",
        },
        devDependencies: {
          jest: "^29.7.0",
          jsdom: "^26.0.0",
          typescript: "^5.4.5",
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "test.yml"),
      [
        "name: Test",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-jest-30-for-jest-29",
    );

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Jest ^29.7.0");
    expect(finding?.message).toContain("30.5");
    expect(finding?.suggestion).toContain("jest/no-alias-methods");
    expect(finding?.suggestion).toContain("30.5.1");
    expect(finding?.aiHandoff).toContain("https://jestjs.io/ja/docs/upgrading-to-jest30");
    expect(finding?.docsPath).toBe("docs/rules/prefer-jest-30-for-jest-29.md");
  });

  test("does not recommend Jest 30 when TypeScript or JSDOM compatibility is below the floor", async () => {
    const fixtureRoot = await tempDirs.create("apl-jest-30-blocked-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "jest-30-blocked",
        scripts: {
          test: "jest",
        },
        devDependencies: {
          jest: "^29.7.0",
          jsdom: "^25.0.0",
          typescript: "^5.3.3",
        },
      }),
    );
    await writeFile(
      path.join(workflowDir, "test.yml"),
      [
        "name: Test",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((finding) => finding.ruleId === "prefer-jest-30-for-jest-29")).toBe(
      false,
    );
  });

  test("recommends Jest 30.5 from Jest 30.4", async () => {
    const fixtureRoot = await tempDirs.create("apl-jest-30-5-like-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "jest-30-5-like",
        scripts: { test: "jest" },
        devDependencies: { jest: "30.4.0" },
      }),
    );
    await writeFile(
      path.join(workflowDir, "test.yml"),
      [
        "name: Test",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-jest-30-for-jest-29",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Jest 30.5");
    expect(finding?.suggestion).toContain("30.5.1");
  });

  test("skips when already on Jest 30.5", async () => {
    const fixtureRoot = await tempDirs.create("apl-jest-30-5-ok-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "jest-30-5-ok",
        scripts: { test: "jest" },
        devDependencies: { jest: "^30.5.1" },
      }),
    );
    await writeFile(
      path.join(workflowDir, "test.yml"),
      [
        "name: Test",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((finding) => finding.ruleId === "prefer-jest-30-for-jest-29")).toBe(
      false,
    );
  });

  test("suggests a modern test runner for a Jest-only project", async () => {
    const fixtureRoot = await tempDirs.create("apl-modern-runner-jest-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "modern-runner-jest",
        scripts: { test: "jest" },
        devDependencies: { jest: "^30.4.0" },
      }),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "test.yml"),
      ["name: Test", "on: push", "jobs:", "  test:", "    runs-on: ubuntu-latest"].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find((c) => c.ruleId === "recommend-modern-test-runner");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.docsPath).toBe("docs/rules/recommend-modern-test-runner.md");
    expect(finding?.message).toContain("Vitest");
    expect(finding?.suggestion).toContain("bun:test");
    expect(finding?.suggestion).toContain("node:test");
  });

  test("prefers bun:test when the project already uses Bun", async () => {
    const fixtureRoot = await tempDirs.create("apl-modern-runner-bun-");
    await writeFile(path.join(fixtureRoot, "bun.lock"), "");
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "modern-runner-bun",
        scripts: { test: "jest" },
        devDependencies: { jest: "^29.7.0" },
      }),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find((c) => c.ruleId === "recommend-modern-test-runner");
    expect(finding).toBeDefined();
    expect(finding?.message).toContain("bun:test");
  });

  test("skips when a modern runner is already present", async () => {
    const fixtureRoot = await tempDirs.create("apl-modern-runner-vitest-");
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "modern-runner-vitest",
        scripts: { test: "vitest" },
        devDependencies: { jest: "^29.7.0", vitest: "^4.1.0" },
      }),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((c) => c.ruleId === "recommend-modern-test-runner")).toBe(false);
  });

  async function jsRepo(
    packageJson: Record<string, unknown>,
    options: { workflowLines?: string[]; extraFiles?: Record<string, string> } = {},
  ) {
    const fixtureRoot = await tempDirs.create("apl-knip-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify(packageJson));
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        ...(options.workflowLines ?? ["      - run: npm test"]),
      ].join("\n"),
    );
    for (const [name, contents] of Object.entries(options.extraFiles ?? {})) {
      await writeFile(path.join(fixtureRoot, name), contents);
    }
    return fixtureRoot;
  }

  test("recommends knip when there is no visible unused-code check", async () => {
    const fixtureRoot = await jsRepo({
      name: "knip-like",
      scripts: { test: "jest" },
      dependencies: { react: "^19.0.0", lodash: "^4.17.21" },
      devDependencies: {
        jest: "^30.5.1",
        typescript: "^5.9.0",
        eslint: "^9.0.0",
        vite: "^8.0.0",
      },
    });

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find((c) => c.ruleId === "prefer-knip-in-ci");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.docsPath).toBe("docs/rules/prefer-knip-in-ci.md");
    expect(finding?.message).toContain("knip");
    expect(finding?.suggestion).toContain("npx knip");
  });

  test("skips knip suggestion when knip is a dependency", async () => {
    const fixtureRoot = await jsRepo({
      name: "knip-dep",
      dependencies: { react: "^19.0.0", lodash: "^4.17.21" },
      devDependencies: { vitest: "^4.1.0", typescript: "^5.9.0", knip: "^5.0.0" },
    });

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((c) => c.ruleId === "prefer-knip-in-ci")).toBe(false);
  });

  test("skips knip suggestion when CI runs knip", async () => {
    const fixtureRoot = await jsRepo(
      {
        name: "knip-ci",
        dependencies: { react: "^19.0.0", lodash: "^4.17.21" },
        devDependencies: { vitest: "^4.1.0", typescript: "^5.9.0", eslint: "^9.0.0" },
      },
      { workflowLines: ["      - run: npx knip"] },
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((c) => c.ruleId === "prefer-knip-in-ci")).toBe(false);
  });

  test("skips knip suggestion when a knip config file exists", async () => {
    const fixtureRoot = await jsRepo(
      {
        name: "knip-config",
        dependencies: { react: "^19.0.0", lodash: "^4.17.21" },
        devDependencies: { vitest: "^4.1.0", typescript: "^5.9.0", eslint: "^9.0.0" },
      },
      { extraFiles: { "knip.json": "{}" } },
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((c) => c.ruleId === "prefer-knip-in-ci")).toBe(false);
  });

  test("skips knip suggestion when the project has no dependencies", async () => {
    const fixtureRoot = await jsRepo({ name: "knip-empty", scripts: { test: "node --test" } });

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(report.findings.some((c) => c.ruleId === "prefer-knip-in-ci")).toBe(false);
  });
});
