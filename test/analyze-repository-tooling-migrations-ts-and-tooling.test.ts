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

describe("migrations: typescript and developer tooling", () => {
  test("treats oxlint migration as warning when visible eslint plugins are covered", async () => {
    const report = await getFixtureReport(fixtures.tsToolingLike, {
      targetPath: ".",
      topCount: 20,
    });

    const oxlintFinding = report.findings.find(
      (finding) => finding.ruleId === "prefer-oxlint-over-eslint",
    );

    expect(report.workflowCount).toBe(1);
    expect(oxlintFinding?.severity).toBe("warning");
    expect(oxlintFinding?.message).toContain("Repository appears to use ESLint");
    expect(oxlintFinding?.why).toContain("react");
    expect(oxlintFinding?.suggestion).toContain("Migrate from ESLint");
  });

  test("treats oxlint migration as suggestion when unsupported eslint plugins are visible", async () => {
    const strictReport = await getFixtureReport(fixtures.tsToolingCustomLike, {
      targetPath: ".",
      topCount: 20,
    });
    const exploratoryReport = await getFixtureReport(fixtures.tsToolingCustomLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      strictReport.findings.some((finding) => finding.ruleId === "prefer-oxlint-over-eslint"),
    ).toBe(false);

    const oxlintFinding = exploratoryReport.findings.find(
      (finding) => finding.ruleId === "prefer-oxlint-over-eslint",
    );

    expect(oxlintFinding?.severity).toBe("suggestion");
    expect(oxlintFinding?.why).toContain("security");
    expect(oxlintFinding?.aiHandoff).toContain("Migrate from ESLint");
  });

  test("treats oxfmt migration as warning when no prettier plugins are visible", async () => {
    const report = await getFixtureReport(fixtures.formattingLike, {
      targetPath: ".",
      topCount: 20,
    });

    const oxfmtFinding = report.findings.find(
      (finding) => finding.ruleId === "prefer-oxfmt-over-prettier",
    );

    expect(report.workflowCount).toBe(1);
    expect(oxfmtFinding?.severity).toBe("warning");
    expect(oxfmtFinding?.message).toContain("Repository appears to use Prettier");
    expect(oxfmtFinding?.why).toContain("minimal script, CI, and hook changes");
    expect(oxfmtFinding?.suggestion).toContain("Migrate from Prettier");
    expect(oxfmtFinding?.suggestion).toContain("reduce formatter runtime");
    expect(oxfmtFinding?.suggestion).toContain("drop-in-style migration path");
  });

  test("treats oxfmt migration as suggestion when prettier plugins are visible", async () => {
    const strictReport = await getFixtureReport(fixtures.formattingPluginLike, {
      targetPath: ".",
      topCount: 20,
    });
    const exploratoryReport = await getFixtureReport(fixtures.formattingPluginLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      strictReport.findings.some((finding) => finding.ruleId === "prefer-oxfmt-over-prettier"),
    ).toBe(false);

    const oxfmtFinding = exploratoryReport.findings.find(
      (finding) => finding.ruleId === "prefer-oxfmt-over-prettier",
    );

    expect(oxfmtFinding?.severity).toBe("suggestion");
    expect(oxfmtFinding?.why).toContain("minimal script, CI, and hook changes");
    expect(oxfmtFinding?.why).toContain("prettier-plugin-tailwindcss");
    expect(oxfmtFinding?.suggestion).toContain("faster drop-in-style formatter");
    expect(oxfmtFinding?.aiHandoff).toContain("Migrate from Prettier");
  });

  test("flags repo-aware prettier-through-eslint usage from repository evidence", async () => {
    const report = await getFixtureReport(fixtures.prettierThroughEslintLike, {
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-eslint-plugin-prettier",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("Repository config shows Prettier");
    expect(finding?.why).toContain("eslint-plugin-prettier");
    expect(finding?.why).toContain("plugin:prettier/recommended");
    expect(finding?.location.path).not.toContain(".github/workflows");
    expect(finding?.location.path).toMatch(/eslint\.config|package\.json/);
    expect(report.findings.some((candidate) => candidate.ruleId === "avoid-prettier-eslint")).toBe(
      false,
    );
  });

  test("flags repo-aware prettier-eslint usage from repository evidence", async () => {
    const report = await getFixtureReport(fixtures.prettierEslintLike, {
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "avoid-prettier-eslint",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("prettier-eslint");
    expect(finding?.why).toContain("prettier-eslint");
  });

  test("flags outdated husky version and redundant hook bootstrap separately", async () => {
    const report = await getFixtureReport(fixtures.huskyLike, {
      targetPath: ".",
      topCount: 20,
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));
    const outdatedHuskyFinding = report.findings.find(
      (finding) => finding.ruleId === "outdated-husky-version",
    );

    expect(report.workflowCount).toBe(1);
    expect(ruleIds.has("outdated-husky-version")).toBe(true);
    expect(ruleIds.has("redundant-bootstrap-in-husky-hook")).toBe(true);
    expect(outdatedHuskyFinding?.location.path).toBe("package.json");
    expect(outdatedHuskyFinding?.location.line).toBe(6);
  });

  test("does not flag modern husky when bootstrap is already simplified", async () => {
    const report = await getFixtureReport(fixtures.huskyModernLike, {
      targetPath: ".",
      topCount: 20,
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleIds.has("outdated-husky-version")).toBe(false);
    expect(ruleIds.has("redundant-bootstrap-in-husky-hook")).toBe(false);
    expect(ruleIds.has("prefer-lefthook-for-complex-git-hooks")).toBe(false);
  });

  test("suggests lefthook only for more complex husky or lint-staged setups", async () => {
    const report = await getFixtureReport(fixtures.huskyComplexLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-lefthook-for-complex-git-hooks",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("moderately complex");
    expect(finding?.why).toContain("lint-staged pattern");
  });

  test("recommends eslint-plugin-import-x from repository-level eslint evidence", async () => {
    const report = await getFixtureReport(fixtures.importPluginLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-eslint-plugin-import-x",
    );

    expect(report.workflowCount).toBe(2);
    expect(hits.length).toBe(1);
    expect(hits[0]!.scope).toBe("repository");
    expect(hits[0]!.message).toContain("eslint-plugin-import");
    expect(hits[0]!.suggestion).toContain("eslint-plugin-import-x");
  });

  test("does not flag repositories that already use eslint-plugin-import-x", async () => {
    const report = await getFixtureReport(fixtures.importXLike, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "prefer-eslint-plugin-import-x"),
    ).toBe(false);
  });

  test("does not recommend eslint-plugin-import-x from shared preset names alone", async () => {
    const fixtureRoot = await tempDirs.create("apl-import-preset-only-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "import-preset-only",
          private: true,
          devDependencies: {
            eslint: "^9.0.0",
            "@ephys/eslint-config-typescript": "^1.0.0",
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(fixtureRoot, "eslint.config.mjs"),
      'import preset from "@ephys/eslint-config-typescript";\nexport default [preset];\n',
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "ci.yml"),
      [
        "name: ci",
        "on: pull_request",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: eslint .",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "prefer-eslint-plugin-import-x"),
    ).toBe(false);
  });

  test("recommends nextest for heavy-looking Rust cargo test jobs only", async () => {
    const report = await getFixtureReport(fixtures.rustNextestLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-nextest-for-heavy-rust-tests",
    );

    expect(report.workflowCount).toBe(1);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    const workflowHit = hits.find((h) => h.scope === "workflow");
    const repositoryHit = hits.find((h) => h.scope === "repository");
    if (workflowHit) {
      expect(workflowHit.message).toContain('Job "workspace_tests"');
    }
    if (repositoryHit) {
      expect(repositoryHit.message).toContain("heavy-looking Rust test");
    }
  });

  test("does not recommend nextest when the repository already uses nextest", async () => {
    const report = await getFixtureReport(fixtures.rustNextestOk, {
      targetPath: ".",
      topCount: 20,
    });

    const ruleIds = new Set(report.findings.map((finding) => finding.ruleId));

    expect(report.workflowCount).toBe(1);
    expect(ruleIds.has("prefer-nextest-for-heavy-rust-tests")).toBe(false);
  });
});
