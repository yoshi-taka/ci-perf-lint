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
    expect(finding?.suggestion).toContain("jest/no-alias-methods");
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
});
