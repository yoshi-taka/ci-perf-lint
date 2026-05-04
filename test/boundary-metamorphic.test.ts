import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { aggregateFindingsWithMembers, renderReport } from "../src/reporters.ts";
import type { AggregatedFinding, Diagnostic, ReportData } from "../src/types.ts";
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

function normalizeFinding(finding: Diagnostic) {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    confidence: finding.confidence,
    scope: finding.scope,
    docsPath: finding.docsPath,
    workflow: finding.workflow,
    location: finding.location,
    message: finding.message,
    why: finding.why,
    suggestion: finding.suggestion,
    measurementHint: finding.measurementHint,
    aiHandoff: finding.aiHandoff,
    score: finding.score,
  };
}

function normalizeAggregatedFinding(finding: AggregatedFinding) {
  return {
    ruleId: finding.ruleId,
    workflows: [...finding.workflows].sort(),
    docsPath: finding.docsPath,
    scope: finding.scope,
    messages: [...finding.messages].sort(),
    aiHandoffs: [...(finding.aiHandoffs ?? [])].sort(),
    locations: [...finding.locations].sort(),
    jobs: [...finding.jobs].sort(),
    why: finding.why,
    suggestion: finding.suggestion,
    measurementHint: finding.measurementHint,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(sortJsonValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }

  return value;
}

function timeoutFinding(
  workflow: string,
  jobName: string,
  line: number,
  score: number,
): Diagnostic {
  return {
    ruleId: "missing-timeout-minutes",
    severity: "warning",
    confidence: "medium",
    docsPath: "docs/rules/missing-timeout-minutes.md",
    workflow,
    location: { path: workflow, line, column: 3 },
    message: `Job "${jobName}" does not define job-level timeout-minutes.`,
    why: "Hung jobs can waste runner time.",
    suggestion:
      "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
    measurementHint:
      "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
    aiHandoff: `Review ${workflow} job "${jobName}" and add a sensible timeout-minutes value without breaking legitimate long-running work.`,
    score,
  };
}

describe("metamorphic relations", () => {
  test("workflow-only and repository-only findings match full-report partitions", async () => {
    const options = { targetPath: ".", topCount: 50, mode: "exploratory" as const };
    const fullReport = await getFixtureReport(fixtures.barrelFileLike, options);
    const workflowOnlyReport = await getFixtureReport(fixtures.barrelFileLike, {
      ...options,
      workflowOnly: true,
    });
    const repositoryOnlyReport = await getFixtureReport(fixtures.barrelFileLike, {
      ...options,
      repositoryOnly: true,
    });

    const workflowPartition = fullReport.findings
      .filter((finding) => finding.scope !== "repository")
      .map(normalizeFinding);
    const repositoryPartition = fullReport.findings
      .filter((finding) => finding.scope === "repository")
      .map(normalizeFinding);

    expect(workflowOnlyReport.findings.map(normalizeFinding)).toEqual(workflowPartition);
    expect(repositoryOnlyReport.findings.map(normalizeFinding)).toEqual(repositoryPartition);
  });

  test("workflow findings stay stable across comments, blank lines, and key reordering", async () => {
    const fixtureRoot = await tempDirs.create("apl-metamorphic-yaml-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    const workflowPath = path.join(workflowDir, "ci.yml");
    const baseWorkflow = [
      "name: ci",
      "on: push",
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: npm install",
    ].join("\n");
    const reformattedWorkflow = [
      "# same workflow, different presentation",
      "on: push",
      "",
      "name: ci",
      "jobs:",
      "  build:",
      "    steps:",
      "      # install deps",
      "      - uses: actions/checkout@v4",
      "",
      "      - run: npm install",
      "    runs-on: ubuntu-latest",
    ].join("\n");

    await writeFile(workflowPath, baseWorkflow);
    const baseReport = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
      workflowOnly: true,
    });

    await writeFile(workflowPath, reformattedWorkflow);
    const reformattedReport = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
      workflowOnly: true,
    });

    expect(reformattedReport.findings.map(normalizeFinding)).toEqual(
      baseReport.findings.map(normalizeFinding),
    );
  });

  test("aggregated findings stay equivalent when input finding order changes", () => {
    const findings: Diagnostic[] = [
      timeoutFinding(".github/workflows/ci.yml", "build", 12, 80),
      timeoutFinding(".github/workflows/release.yml", "build", 16, 79),
      timeoutFinding(".github/workflows/test.yml", "lint", 20, 70),
      timeoutFinding(".github/workflows/test.yml", "lint", 24, 69),
    ];
    const shuffled = [findings[2]!, findings[0]!, findings[3]!, findings[1]!];

    const baseAggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const shuffledAggregated = aggregateFindingsWithMembers(shuffled).aggregatedFindings;

    expect(
      baseAggregated
        .map(normalizeAggregatedFinding)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    ).toEqual(
      shuffledAggregated
        .map(normalizeAggregatedFinding)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    );
  });

  test("findings-only render output depends only on report.findings", () => {
    const findings: Diagnostic[] = [
      timeoutFinding(".github/workflows/ci.yml", "build", 12, 80),
      timeoutFinding(".github/workflows/release.yml", "build", 16, 79),
    ];

    const baseReport: ReportData = {
      targetPath: "/repo-a",
      workflowCount: 2,
      scannedAt: "2026-05-05T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregateFindingsWithMembers(findings).aggregatedFindings,
      findings,
      workflows: [],
      fixFirst: ["base fix"],
      aiHandoff: ["base handoff"],
      analysisWarnings: [{ source: "base", message: "base warning" }],
    };
    const mutatedReport: ReportData = {
      targetPath: "/repo-b",
      workflowCount: 99,
      scannedAt: "2030-01-01T00:00:00.000Z",
      topFindings: [],
      topAggregatedFindings: [],
      findings,
      workflows: [
        {
          path: ".github/workflows/unused.yml",
          name: "unused",
          findings: [],
        },
      ],
      fixFirst: ["different fix"],
      aiHandoff: ["different handoff"],
      analysisWarnings: [{ source: "mutated", message: "mutated warning" }],
    };

    expect(renderReport(baseReport, "text", { findingsOnly: true })).toBe(
      renderReport(mutatedReport, "text", { findingsOnly: true }),
    );
    expect(renderReport(baseReport, "markdown", { findingsOnly: true })).toBe(
      renderReport(mutatedReport, "markdown", { findingsOnly: true }),
    );
    expect(renderReport(baseReport, "handoff", { findingsOnly: true, mode: "strict" })).toBe(
      renderReport(mutatedReport, "handoff", { findingsOnly: true, mode: "strict" }),
    );
    expect(renderReport(baseReport, "json", { findingsOnly: true })).toBe(
      renderReport(mutatedReport, "json", { findingsOnly: true }),
    );
  });

  test("default text and markdown body stay stable when only topCount note eligibility changes", () => {
    const findings: Diagnostic[] = [
      timeoutFinding(".github/workflows/ci.yml", "build", 12, 80),
      timeoutFinding(".github/workflows/release.yml", "build", 16, 79),
    ];
    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 2,
      scannedAt: "2026-05-05T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregated,
      findings,
      workflows: [],
      fixFirst: [
        "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
      ],
      aiHandoff: ["handoff"],
      analysisWarnings: [],
    };

    const textWithNote = renderReport(report, "text", { topCount: 5 });
    const textWithoutNote = renderReport(report, "text", { topCount: 1 });
    const markdownWithNote = renderReport(report, "markdown", { topCount: 5 });
    const markdownWithoutNote = renderReport(report, "markdown", { topCount: 1 });

    expect(textWithNote).toContain("Only 1 finding available in this scan mode.");
    expect(textWithoutNote).not.toContain("Only 1 finding available in this scan mode.");
    expect(textWithNote.replace("\n\nOnly 1 finding available in this scan mode.", "")).toBe(
      textWithoutNote,
    );

    expect(markdownWithNote).toContain("_Only 1 finding available in this scan mode._");
    expect(markdownWithoutNote).not.toContain("_Only 1 finding available in this scan mode._");
    expect(markdownWithNote.replace("\n\n_Only 1 finding available in this scan mode._", "")).toBe(
      markdownWithoutNote,
    );
  });

  test("json render is semantically stable across render options after normalization", () => {
    const findings: Diagnostic[] = [
      timeoutFinding(".github/workflows/ci.yml", "build", 12, 80),
      timeoutFinding(".github/workflows/release.yml", "build", 16, 79),
    ];
    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 2,
      scannedAt: "2026-05-05T00:00:00.000Z",
      topFindings: findings,
      topAggregatedFindings: aggregated,
      findings,
      workflows: [],
      fixFirst: ["fix"],
      aiHandoff: ["handoff"],
      analysisWarnings: [{ source: "s", message: "m" }],
    };

    const jsonA = JSON.parse(renderReport(report, "json", { topCount: 1, mode: "strict" }));
    const jsonB = JSON.parse(
      renderReport(report, "json", { topCount: 50, mode: "exploratory", showAllLocations: true }),
    );
    const findingsOnlyA = JSON.parse(
      renderReport(report, "json", { findingsOnly: true, mode: "strict" }),
    );
    const findingsOnlyB = JSON.parse(
      renderReport(report, "json", {
        findingsOnly: true,
        topCount: 99,
        mode: "exploratory",
        showAllLocations: true,
      }),
    );

    expect(sortJsonValue(jsonA)).toEqual(sortJsonValue(jsonB));
    expect(sortJsonValue(findingsOnlyA)).toEqual(sortJsonValue(findingsOnlyB));
  });
});
