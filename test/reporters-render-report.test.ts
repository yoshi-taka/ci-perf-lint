import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAiHandoff } from "../src/ai-handoff.ts";
import { aggregateFindingsWithMembers, renderReport } from "../src/reporters.ts";
import type { Diagnostic, ReportData } from "../src/types.ts";
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

describe("renderReport", () => {
  test("renders markdown report with handoff section", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 3,
      mode: "exploratory",
    });

    const markdown = renderReport(report, "markdown");

    expect(markdown).toContain("# GitHub Actions Performance Lint");
    expect(markdown).toContain("## AI Handoff");
    expect(markdown).toContain("missing-paths-filter");
  });

  test("renders consolidated handoff output", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 3,
      mode: "exploratory",
    });

    const handoff = renderReport(report, "handoff", { topCount: 3, mode: "exploratory" });

    expect(handoff).toContain("Update this repository using the performance findings below.");
    expect(handoff).toContain(
      "Scope of this handoff: top 3 findings from exploratory mode, sorted by score with deterministic tie-breakers, not the full finding list. Use --top <n> to change this.",
    );
    expect(handoff).toContain("Before editing:");
    expect(handoff).toContain("After editing:");
    expect(handoff).toContain(
      "Compare before/after using the measurement hints plus MCP, CI observability links, or logs when available.",
    );
  });

  test("notes when fewer top findings are available than requested", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardLike, {
      targetPath: ".",
      topCount: 8,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { topCount: 8, mode: "strict" });
    const text = renderReport(report, "text", { topCount: 8, mode: "strict" });
    const markdown = renderReport(report, "markdown", { topCount: 8, mode: "strict" });

    expect(report.topAggregatedFindings.length).toBeLessThan(8);
    expect(handoff).toContain("Only 2 findings available in this scan mode.");
    expect(text).toContain("Only 2 findings available in this scan mode.");
    expect(markdown).toContain("_Only 2 findings available in this scan mode._");
  });

  test("aggregates repeated workflow-rule handoff guidance into one line", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardManyLike, {
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(handoff).toContain(
      'Review .github/workflows/release.yml for repeated missing-release-downstream-success-guard findings affecting jobs "npm", "npm-types", "docker".',
    );
    expect(handoff).not.toContain('Review .github/workflows/release.yml job "npm"');
    expect(handoff).not.toContain('Review .github/workflows/release.yml job "npm-types"');
    expect(handoff).not.toContain('Review .github/workflows/release.yml job "docker"');
  });

  test("aggregates repeated findings in the handoff findings section too", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardManyLike, {
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(handoff).toContain("1. missing-release-downstream-success-guard (");
    expect(handoff).toContain(
      "https://ci-perf-lint.veritycost.com/rules/missing-release-downstream-success-guard)",
    );
    expect(handoff).toContain(".github/workflows/release.yml:");
    expect(handoff).toContain("+2 more");
    expect(handoff).toContain('Affected jobs: "npm", "npm-types", "docker"');
    expect(handoff).not.toContain(
      "2. missing-release-downstream-success-guard (.github/workflows/release.yml:",
    );
  });

  test("labels repository-wide findings in output", async () => {
    const report = await getFixtureReport(fixtures.tsToolingLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { topCount: 20, mode: "strict" });
    const text = renderReport(report, "text");
    const markdown = renderReport(report, "markdown");

    expect(report.findings.some((finding) => finding.scope === "repository")).toBe(true);
    expect(handoff).toContain("Scope: repository-wide source/tooling.");
    expect(text).toContain("[repository-wide source/tooling]");
    expect(markdown).toContain("- Scope: `repository-wide source/tooling`");
  });

  test("aggregates repeated repository-wide source findings into one top finding", () => {
    const findings: Diagnostic[] = [
      {
        ruleId: "prefer-explicit-import-extensions",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: "docs/rules/prefer-explicit-import-extensions.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: "src/App.ts", line: 1, column: 1 },
        message: "Embedded Oxlint scan flagged an extensionless import in src/App.ts.",
        why: "Extensionless imports make resolvers probe multiple files.",
        suggestion: "Add explicit file extensions to relative imports.",
        measurementHint: "Compare Vite startup time before and after.",
        aiHandoff: "Review embedded Oxlint import/extensions findings.",
        score: 84,
      },
      {
        ruleId: "prefer-explicit-import-extensions",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: "docs/rules/prefer-explicit-import-extensions.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: "src/main.ts", line: 2, column: 1 },
        message: "Embedded Oxlint scan flagged an extensionless import in src/main.ts.",
        why: "Extensionless imports make resolvers probe multiple files.",
        suggestion: "Add explicit file extensions to relative imports.",
        measurementHint: "Compare Vite startup time before and after.",
        aiHandoff: "Review embedded Oxlint import/extensions findings.",
        score: 84,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 1,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregated,
      findings,
      workflows: [],
      fixFirst: ["Add explicit file extensions to relative imports."],
      aiHandoff: ["Review embedded Oxlint import/extensions findings."],
      analysisWarnings: [],
      propagationClusters: [],
    };
    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.locations).toEqual(["src/App.ts:1:1", "src/main.ts:2:1"]);
    expect(handoff).toContain(
      "prefer-explicit-import-extensions (src/App.ts:1:1 +1 more, https://ci-perf-lint.veritycost.com/rules/prefer-explicit-import-extensions)",
    );
    expect(handoff).toContain(
      "Context: prefer-explicit-import-extensions appears in 2 source/tooling locations",
    );
    expect(handoff).toContain(
      "Why it matters: Extensionless imports make resolvers probe multiple files.",
    );
    expect(handoff).not.toContain("attached to a representative workflow");
  });

  test("aggregates repeated repository-wide source guidance in before-editing handoff", () => {
    const findings: Diagnostic[] = Array.from({ length: 7 }, (_, index) => {
      const fileNumber = index + 1;
      return {
        ruleId: "detected-large-barrel-file",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: "docs/rules/detected-large-barrel-file.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: `src/file-${fileNumber}.ts`, line: 1, column: 15 },
        message: `Oxlint flagged an oversized barrel file in src/file-${fileNumber}.ts.`,
        why: "Large barrel files can expand dependency graphs and source transforms.",
        suggestion:
          "Replace broad `export *` barrel usage with direct imports or narrower explicit re-exports.",
        measurementHint:
          "Compare lint, test, typecheck, or build wall-clock time before and after.",
        aiHandoff: `Review src/file-${fileNumber}.ts and remove broad \`export *\` barrel patterns that Oxlint flagged as oversized.`,
        score: 84,
      };
    });

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 1,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregated,
      findings,
      workflows: [],
      fixFirst: ["Replace broad `export *` barrel usage."],
      aiHandoff: buildAiHandoff(aggregated),
      analysisWarnings: [],
      propagationClusters: [],
    };

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(handoff).toContain(
      "Review repeated detected-large-barrel-file findings across 7 source/tooling locations",
    );
    expect(handoff).toContain("`src/file-5.ts:1:15`, +2 more");
    expect(handoff).not.toContain("Review src/file-6.ts and remove broad");
    expect(handoff).not.toContain("Review src/file-7.ts and remove broad");
  });

  test("limits rendered affected locations to five by default", () => {
    const locations = Array.from({ length: 22 }, (_, index) => `src/file-${index + 1}.ts:1:1`);
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 1,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: [],
      topAggregatedFindings: [
        {
          ruleId: "prefer-explicit-import-extensions",
          workflow: ".github/workflows/ci.yml",
          workflows: [".github/workflows/ci.yml"],
          docsPath: "docs/rules/prefer-explicit-import-extensions.md",
          scope: "repository",
          messages: ["Embedded Oxlint scan flagged an extensionless import in src/file-1.ts."],
          locations,
          jobs: [],
          why: "Extensionless imports make resolvers probe multiple files.",
          suggestion: "Add explicit file extensions to relative imports.",
          measurementHint: "Compare Vite startup time before and after.",
          firstIndex: 0,
        },
      ],
      findings: [
        {
          ruleId: "prefer-explicit-import-extensions",
          severity: "warning",
          confidence: "medium",
          scope: "repository",
          docsPath: "docs/rules/prefer-explicit-import-extensions.md",
          workflow: ".github/workflows/ci.yml",
          location: { path: "src/file-1.ts", line: 1, column: 1 },
          message: "Embedded Oxlint scan flagged an extensionless import in src/file-1.ts.",
          why: "Extensionless imports make resolvers probe multiple files.",
          suggestion: "Add explicit file extensions to relative imports.",
          measurementHint: "Compare Vite startup time before and after.",
          aiHandoff: "Review embedded Oxlint import/extensions findings.",
          score: 84,
        },
      ],
      workflows: [],
      fixFirst: ["Add explicit file extensions to relative imports."],
      aiHandoff: ["Review embedded Oxlint import/extensions findings."],
      analysisWarnings: [],
      propagationClusters: [],
    };

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });
    const markdown = renderReport(report, "markdown");

    expect(handoff).toContain("Affected locations: `src/file-1.ts:1:1`");
    expect(handoff).toContain("`src/file-5.ts:1:1`, +17 more");
    expect(handoff).not.toContain("`src/file-6.ts:1:1`");
    expect(markdown).not.toContain("`src/file-6.ts:1:1`");
    expect(markdown).toContain("+17 more");
  });

  test("renders all affected locations when requested", () => {
    const locations = Array.from({ length: 7 }, (_, index) => `src/file-${index + 1}.ts:1:1`);
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 1,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: [],
      topAggregatedFindings: [
        {
          ruleId: "prefer-explicit-import-extensions",
          workflow: ".github/workflows/ci.yml",
          workflows: [".github/workflows/ci.yml"],
          docsPath: "docs/rules/prefer-explicit-import-extensions.md",
          scope: "repository",
          messages: ["Embedded Oxlint scan flagged an extensionless import in src/file-1.ts."],
          locations,
          jobs: [],
          why: "Extensionless imports make resolvers probe multiple files.",
          suggestion: "Add explicit file extensions to relative imports.",
          measurementHint: "Compare Vite startup time before and after.",
          firstIndex: 0,
        },
      ],
      findings: [
        {
          ruleId: "prefer-explicit-import-extensions",
          severity: "warning",
          confidence: "medium",
          scope: "repository",
          docsPath: "docs/rules/prefer-explicit-import-extensions.md",
          workflow: ".github/workflows/ci.yml",
          location: { path: "src/file-1.ts", line: 1, column: 1 },
          message: "Embedded Oxlint scan flagged an extensionless import in src/file-1.ts.",
          why: "Extensionless imports make resolvers probe multiple files.",
          suggestion: "Add explicit file extensions to relative imports.",
          measurementHint: "Compare Vite startup time before and after.",
          aiHandoff: "Review embedded Oxlint import/extensions findings.",
          score: 84,
        },
      ],
      workflows: [],
      fixFirst: ["Add explicit file extensions to relative imports."],
      aiHandoff: ["Review embedded Oxlint import/extensions findings."],
      analysisWarnings: [],
      propagationClusters: [],
    };

    const handoff = renderReport(report, "handoff", {
      topCount: 5,
      mode: "strict",
      showAllLocations: true,
    });

    expect(handoff).toContain("`src/file-7.ts:1:1`");
    expect(handoff).not.toContain("+2 more");
  });

  test("renders concise no-findings handoff output", async () => {
    const report = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 3,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff");

    expect(report.findings).toHaveLength(0);
    expect(handoff).toContain("No actionable findings in the current scan mode.");
    expect(handoff).toContain("rerun with --mode exploratory");
    expect(handoff).not.toContain("Before editing:");
    expect(handoff).not.toContain("Address these findings first:");
    expect(handoff).not.toContain("Constraints:");
  });

  test("renders concise no-findings text and markdown output", async () => {
    const report = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 3,
      mode: "strict",
    });

    const text = renderReport(report, "text");
    const markdown = renderReport(report, "markdown");

    expect(text).toContain("No actionable findings in the current scan mode.");
    expect(text).toContain("rerun with --mode exploratory");
    expect(text).not.toContain("Top findings:");

    expect(markdown).toContain("# GitHub Actions Performance Lint");
    expect(markdown).toContain("- No actionable findings in the current scan mode.");
    expect(markdown).toContain(
      "- If you want advisory suggestions too, rerun with --mode exploratory.",
    );
    expect(markdown).not.toContain("## Top Findings");
  });

  test("renders findings-only output", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 5,
      mode: "exploratory",
    });

    const text = renderReport(report, "text", { findingsOnly: true });
    const json = renderReport(report, "json", { findingsOnly: true });

    expect(text).toContain("missing-concurrency");
    expect(text).not.toContain("Top fixes to consider:");
    expect(text).not.toContain("AI handoff:");
    expect(Array.isArray(JSON.parse(json))).toBe(true);
  });

  test("renders findings-only output with the actual source location when it differs from the workflow", async () => {
    const report = await getFixtureReport(fixtures.huskyLike, {
      targetPath: ".",
      topCount: 20,
    });

    const text = renderReport(report, "text", { findingsOnly: true });
    const handoff = renderReport(report, "handoff", { findingsOnly: true, mode: "strict" });

    expect(text).toContain("outdated-husky-version (package.json:6:5)");
    expect(handoff).toContain("outdated-husky-version at package.json:6:5");
  });

  test("renders handoff guidance with evidence location first for repo-aware husky findings", async () => {
    const report = await getFixtureReport(fixtures.huskyLike, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { topCount: 20, mode: "strict" });

    expect(handoff).toContain("Review the repository Husky setup at package.json:6:5.");
    expect(handoff).toContain("This finding surfaced while scanning .github/workflows/nodejs.yml.");
    expect(handoff).toContain("Review the repository Husky hook files `.husky/pre-commit`.");
  });

  test("renders one handoff line for same-location no-job findings across workflows", () => {
    const findings: Diagnostic[] = [
      {
        ruleId: "outdated-husky-version",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/outdated-husky-version.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: "package.json", line: 130, column: 5 },
        message: "The repository uses Husky ^1.0.1, which is at or below 9.1.1.",
        why: "Older Husky setups are more likely to keep deprecated bootstrap patterns.",
        suggestion: "Upgrade Husky to the latest v9 release.",
        measurementHint: "Compare local hook startup time before and after upgrading Husky.",
        aiHandoff:
          "Review the repository Husky setup at package.json:130:5. This finding surfaced while scanning .github/workflows/ci.yml.",
        score: 60,
      },
      {
        ruleId: "outdated-husky-version",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/outdated-husky-version.md",
        workflow: ".github/workflows/release.yml",
        location: { path: "package.json", line: 130, column: 5 },
        message: "The repository uses Husky ^1.0.1, which is at or below 9.1.1.",
        why: "Older Husky setups are more likely to keep deprecated bootstrap patterns.",
        suggestion: "Upgrade Husky to the latest v9 release.",
        measurementHint: "Compare local hook startup time before and after upgrading Husky.",
        aiHandoff:
          "Review the repository Husky setup at package.json:130:5. This finding surfaced while scanning .github/workflows/release.yml.",
        score: 60,
      },
    ];
    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 2,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregated,
      findings,
      workflows: [],
      fixFirst: ["Upgrade Husky to the latest v9 release."],
      aiHandoff: buildAiHandoff(aggregated),
      analysisWarnings: [],
      propagationClusters: [],
    };

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(handoff).toContain(
      "Review package.json:130:5 for repeated outdated-husky-version findings surfaced across workflows `.github/workflows/ci.yml`, `.github/workflows/release.yml`.",
    );
    expect(handoff).toContain(
      "Affected workflows: `.github/workflows/ci.yml`, `.github/workflows/release.yml`",
    );
    expect(handoff).not.toContain(
      "Review the repository Husky setup at package.json:130:5. This finding surfaced while scanning .github/workflows/release.yml.",
    );
  });

  test("renders concise no-findings findings-only handoff output", async () => {
    const report = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });

    const handoff = renderReport(report, "handoff", { findingsOnly: true, mode: "strict" });

    expect(report.findings).toHaveLength(0);
    expect(handoff).toBe("No findings in the current scan mode.");
  });

  test("renders concise no-findings findings-only text and markdown output", async () => {
    const report = await getFixtureReport(fixtures.cleanNoFindings, {
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });

    const text = renderReport(report, "text", { findingsOnly: true });
    const markdown = renderReport(report, "markdown", { findingsOnly: true });

    expect(text).toBe("No findings in the current scan mode.");
    expect(markdown).toContain("- No findings in the current scan mode.");
  });

  test("labels findings-only handoff as the full list for the current mode", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 5,
      mode: "exploratory",
    });

    const handoff = renderReport(report, "handoff", { findingsOnly: true, mode: "exploratory" });

    expect(handoff).toContain("Findings: full finding list from exploratory mode.");
  });

  test("keeps default text output focused on findings instead of duplicating handoff guidance", async () => {
    const report = await getFixtureReport(fixtures.sampleRepo, {
      targetPath: ".",
      topCount: 5,
      mode: "exploratory",
    });

    const text = renderReport(report, "text");

    expect(text).toContain("Top findings:");
    expect(text).not.toContain("Top fixes to consider:");
    expect(text).not.toContain("AI handoff:");
  });

  test("collects internal analysis warnings for malformed repository metadata without changing default text output", async () => {
    const fixtureRoot = await tempDirs.create("apl-analysis-warning-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(path.join(fixtureRoot, "package.json"), '{"name": "broken"\n');
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      ["name: CI", "on: push", "jobs:", "  test:", "    runs-on: ubuntu-latest"].join("\n"),
    );

    const report = await memoizedAnalyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });
    const text = renderReport(report, "text");
    const packageJsonWarning = report.analysisWarnings.find(
      (warning) =>
        warning.source === path.join(fixtureRoot, "package.json") &&
        warning.message.includes("Failed to parse JSON while collecting repository signals"),
    );

    expect(report.analysisWarnings.length).toBeGreaterThan(0);
    expect(packageJsonWarning).toBeDefined();
    expect(
      report.analysisWarnings.filter(
        (warning) =>
          warning.source === path.join(fixtureRoot, "package.json") &&
          warning.message.includes("Failed to parse JSON while collecting repository signals"),
      ),
    ).toHaveLength(1);
    expect(text).toContain("No actionable findings in the current scan mode.");
    expect(text).not.toContain("analysisWarnings");
  });

  describe("TTY formatting (colors and hyperlinks)", () => {
    const ttyOpts = { colors: true, hyperlinks: true, cwd: "/repo" };

    test("colors rule IDs cyan in text format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", ttyOpts);
      expect(text).toContain("\x1b[36m");
      expect(text).toContain("\x1b[0m");
    });

    test("colors rule IDs cyan in handoff format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const handoff = renderReport(report, "handoff", {
        ...ttyOpts,
        topCount: 5,
        mode: "exploratory",
      });
      expect(handoff).toContain("\x1b[36m");
    });

    test("dims source locations in text format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", ttyOpts);
      expect(text).toContain("\x1b[90m");
    });

    test("applies OSC8 hyperlinks to source locations", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", ttyOpts);
      expect(text).toContain("\x1b]8;;file://");
      expect(text).toContain("\x1b]8;;\x1b\\");
    });

    test("applies OSC8 hyperlinks to docs URLs", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", ttyOpts);
      expect(text).toContain("\x1b]8;;https://ci-perf-lint.veritycost.com");
    });

    test("highlights inline code cyan in text format", () => {
      const findings: Diagnostic[] = [
        {
          ruleId: "npm-audit-in-ci",
          severity: "suggestion",
          confidence: "high",
          docsPath: "docs/rules/npm-audit-in-ci.md",
          workflow: ".github/workflows/ci.yml",
          location: { path: ".github/workflows/ci.yml", line: 5, column: 7 },
          message: 'Step "test" runs `npm audit` on every push or PR.',
          why: "Consider using `dependabot` or `renovate` instead.",
          suggestion: "Remove `npm audit` from CI.",
          measurementHint: "Run `npm audit` locally instead.",
          aiHandoff: "Remove npm audit",
          score: 30,
        },
      ];
      const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
      const report: ReportData = {
        targetPath: "/repo",
        workflowCount: 1,
        scannedAt: "2026-04-20T00:00:00.000Z",
        topFindings: findings,
        topAggregatedFindings: aggregated,
        findings,
        workflows: [],
        fixFirst: ["Remove npm audit"],
        aiHandoff: [],
        analysisWarnings: [],
        propagationClusters: [],
      };
      const text = renderReport(report, "text", { ...ttyOpts, topCount: 5, mode: "strict" });
      expect(text).toContain("`\x1b[32mnpm audit\x1b[0m`");
    });

    test("no ANSI codes when colors flag is off", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text");
      expect(text).not.toContain("\x1b[");
    });

    test("no ANSI codes in markdown output even with TTY flags", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const md = renderReport(report, "markdown", ttyOpts);
      expect(md).not.toContain("\x1b[");
    });

    test("no ANSI codes in JSON output even with TTY flags", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const json = renderReport(report, "json", ttyOpts);
      expect(json).not.toContain("\x1b[");
    });

    test("highlights inline code in findings-only handoff", () => {
      const findings: Diagnostic[] = [
        {
          ruleId: "npm-audit-in-ci",
          severity: "suggestion",
          confidence: "high",
          docsPath: "docs/rules/npm-audit-in-ci.md",
          workflow: ".github/workflows/ci.yml",
          location: { path: ".github/workflows/ci.yml", line: 5, column: 7 },
          message: 'Step "test" runs `npm audit` on every push or PR.',
          why: "Consider using `dependabot` or `renovate` instead.",
          suggestion: "Remove `npm audit` from CI.",
          measurementHint: "Run `npm audit` locally instead.",
          aiHandoff: "Remove npm audit",
          score: 30,
        },
      ];
      const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
      const report: ReportData = {
        targetPath: "/repo",
        workflowCount: 1,
        scannedAt: "2026-04-20T00:00:00.000Z",
        topFindings: findings,
        topAggregatedFindings: aggregated,
        findings,
        workflows: [],
        fixFirst: ["Remove npm audit"],
        aiHandoff: [],
        analysisWarnings: [],
        propagationClusters: [],
      };
      const handoff = renderReport(report, "handoff", {
        ...ttyOpts,
        findingsOnly: true,
        mode: "strict",
      });
      expect(handoff).toContain("`\x1b[32mnpm audit\x1b[0m`");
    });

    test("marks header bold in text format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", ttyOpts);
      expect(text).toContain("\x1b[1mGitHub Actions Performance Lint\x1b[0m");
      expect(text).toContain("\x1b[1mTop findings:\x1b[0m");
    });

    test("marks section headers bold in handoff format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const handoff = renderReport(report, "handoff", {
        ...ttyOpts,
        topCount: 5,
        mode: "exploratory",
      });
      expect(handoff).toContain(
        "\x1b[1mUpdate this repository using the performance findings below.\x1b[0m",
      );
      expect(handoff).toContain("\x1b[1mBefore editing:\x1b[0m");
      expect(handoff).toContain("\x1b[1mAddress these findings first:\x1b[0m");
      expect(handoff).toContain("\x1b[1mConstraints:\x1b[0m");
    });

    test("dims labels in handoff format", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const handoff = renderReport(report, "handoff", {
        ...ttyOpts,
        topCount: 5,
        mode: "exploratory",
      });
      expect(handoff).toContain("\x1b[90mWhy it matters:\x1b[0m");
      expect(handoff).toContain("\x1b[90mSuggested action:\x1b[0m");
      expect(handoff).toContain("\x1b[90mVerify:\x1b[0m");
    });

    test("no ANSI codes in findings-only text when colors flag is off", async () => {
      const report = await getFixtureReport(fixtures.sampleRepo, {
        targetPath: ".",
        topCount: 5,
        mode: "exploratory",
      });
      const text = renderReport(report, "text", { findingsOnly: true });
      expect(text).not.toContain("\x1b[");
    });

    test("applies dim to workflow values in affected workflows list", () => {
      const findings: Diagnostic[] = [
        {
          ruleId: "missing-concurrency",
          severity: "suggestion",
          confidence: "high",
          docsPath: "docs/rules/missing-concurrency.md",
          workflow: ".github/workflows/ci.yml",
          location: { path: ".github/workflows/ci.yml", line: 3, column: 5 },
          message: "missing concurrency",
          why: "stale runs waste runner time",
          suggestion: "add concurrency",
          measurementHint: "push multiple commits",
          aiHandoff: "add concurrency",
          score: 58,
        },
        {
          ruleId: "missing-concurrency",
          severity: "suggestion",
          confidence: "high",
          docsPath: "docs/rules/missing-concurrency.md",
          workflow: ".github/workflows/release.yml",
          location: { path: ".github/workflows/release.yml", line: 3, column: 5 },
          message: "missing concurrency",
          why: "stale runs waste runner time",
          suggestion: "add concurrency",
          measurementHint: "push multiple commits",
          aiHandoff: "add concurrency",
          score: 58,
        },
      ];
      const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
      const report: ReportData = {
        targetPath: "/repo",
        workflowCount: 2,
        scannedAt: "2026-04-20T00:00:00.000Z",
        topFindings: findings,
        topAggregatedFindings: aggregated,
        findings,
        workflows: [],
        fixFirst: ["add concurrency"],
        aiHandoff: buildAiHandoff(aggregated),
        analysisWarnings: [],
        propagationClusters: [],
      };
      const handoff = renderReport(report, "handoff", { ...ttyOpts, topCount: 5, mode: "strict" });
      expect(handoff).toContain("\x1b[90m.github/workflows/ci.yml\x1b[0m");
      expect(handoff).toContain("\x1b[90m.github/workflows/release.yml\x1b[0m");
    });

    test("colors --mode exploratory in no-findings text", async () => {
      const report = await getFixtureReport(fixtures.cleanNoFindings, {
        targetPath: ".",
        topCount: 3,
        mode: "strict",
      });
      const text = renderReport(report, "text", { ...ttyOpts, topCount: 3, mode: "strict" });
      expect(text).toContain("\x1b[32m--mode exploratory\x1b[0m");
    });
  });
});
