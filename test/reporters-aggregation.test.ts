import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { aggregateFindingsWithMembers, renderReport } from "../src/reporters.ts";
import type { Diagnostic, ReportData } from "../src/types.ts";

function repositoryFinding(
  location: Diagnostic["location"],
  workflow = ".github/workflows/ci.yml",
): Diagnostic {
  return {
    ruleId: "prefer-explicit-import-extensions",
    severity: "warning",
    confidence: "medium",
    scope: "repository",
    docsPath: "docs/rules/prefer-explicit-import-extensions.md",
    workflow,
    location,
    message: `Embedded Oxlint scan flagged an extensionless import in ${location.path}.`,
    why: "Extensionless imports make resolvers probe multiple files.",
    suggestion: "Add explicit file extensions to relative imports.",
    measurementHint: "Compare Vite startup time before and after.",
    aiHandoff: "Review embedded Oxlint import/extensions findings.",
    score: 84,
  };
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

describe("aggregateFindings and grouped reporter output", () => {
  test("aggregates same job-pattern findings across multiple workflow files in handoff output", () => {
    const report: ReportData = {
      targetPath: "/repo",
      workflowCount: 4,
      scannedAt: "2026-04-20T00:00:00.000Z",
      topFindings: [
        {
          ruleId: "missing-timeout-minutes",
          severity: "warning",
          confidence: "medium",
          docsPath: "docs/rules/missing-timeout-minutes.md",
          workflow: ".github/workflows/release-layer-java.yml",
          location: {
            path: ".github/workflows/release-layer-java.yml",
            line: 23,
            column: 3,
          },
          message: 'Heavy job "build-layer" does not define job-level timeout-minutes.',
          why: "Hung jobs can waste runner time.",
          suggestion:
            "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
          measurementHint:
            "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
          aiHandoff:
            'Review .github/workflows/release-layer-java.yml job "build-layer" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
          score: 80,
        },
        {
          ruleId: "missing-timeout-minutes",
          severity: "warning",
          confidence: "medium",
          docsPath: "docs/rules/missing-timeout-minutes.md",
          workflow: ".github/workflows/release-layer-python.yml",
          location: {
            path: ".github/workflows/release-layer-python.yml",
            line: 23,
            column: 3,
          },
          message: 'Heavy job "build-layer" does not define job-level timeout-minutes.',
          why: "Hung jobs can waste runner time.",
          suggestion:
            "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
          measurementHint:
            "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
          aiHandoff:
            'Review .github/workflows/release-layer-python.yml job "build-layer" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
          score: 79,
        },
      ],
      topAggregatedFindings: [
        {
          ruleId: "missing-timeout-minutes",
          workflow: ".github/workflows/release-layer-java.yml",
          workflows: [
            ".github/workflows/release-layer-java.yml",
            ".github/workflows/release-layer-python.yml",
          ],
          docsPath: "docs/rules/missing-timeout-minutes.md",
          messages: ['Heavy job "build-layer" does not define job-level timeout-minutes.'],
          locations: [
            ".github/workflows/release-layer-java.yml:23:3",
            ".github/workflows/release-layer-python.yml:23:3",
          ],
          jobs: ["build-layer"],
          why: "Hung jobs can waste runner time.",
          suggestion:
            "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
          measurementHint:
            "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
          firstIndex: 0,
        },
      ],
      findings: [],
      workflows: [],
      fixFirst: [
        "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
      ],
      aiHandoff: [
        "Before making workflow changes, inspect recent git history to understand change risk. Also review related pull requests and issues when available.",
        'Review repeated missing-timeout-minutes findings for jobs "build-layer" across workflows `.github/workflows/release-layer-java.yml`, `.github/workflows/release-layer-python.yml`. Apply one consistent fix pattern where appropriate instead of treating each workflow separately.',
      ],
      analysisWarnings: [],
    };
    report.findings = report.topFindings;

    const handoff = renderReport(report, "handoff", { topCount: 5, mode: "strict" });

    expect(handoff).toContain(
      'Review repeated missing-timeout-minutes findings for jobs "build-layer" across workflows `.github/workflows/release-layer-java.yml`, `.github/workflows/release-layer-python.yml`.',
    );
    expect(handoff).toContain(
      "Affected workflows: `.github/workflows/release-layer-java.yml`, `.github/workflows/release-layer-python.yml`",
    );
    expect(handoff).toContain(
      "Affected locations: `.github/workflows/release-layer-java.yml:23:3`, `.github/workflows/release-layer-python.yml:23:3`",
    );
    expect(handoff).toContain('Affected jobs: "build-layer"');
    expect(handoff).not.toContain(
      'Review .github/workflows/release-layer-java.yml job "build-layer"',
    );
    expect(handoff).not.toContain(
      'Review .github/workflows/release-layer-python.yml job "build-layer"',
    );
  });

  test("aggregates uppercase job markers across workflows too", () => {
    const findings: Diagnostic[] = [
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/release-layer-java.yml",
        location: {
          path: ".github/workflows/release-layer-java.yml",
          line: 23,
          column: 3,
        },
        message: 'Job "build-layer" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion:
          "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
        measurementHint:
          "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
        aiHandoff:
          'Review .github/workflows/release-layer-java.yml job "build-layer" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
        score: 80,
      },
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/release-layer-ruby.yml",
        location: {
          path: ".github/workflows/release-layer-ruby.yml",
          line: 23,
          column: 3,
        },
        message: 'JOB "build-layer" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion:
          "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.",
        measurementHint:
          "Force or simulate a hung run and confirm the job is terminated at the configured timeout.",
        aiHandoff:
          'Review .github/workflows/release-layer-ruby.yml job "build-layer" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
        score: 79,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.jobs).toEqual(["build-layer"]);
    expect(aggregated[0]?.workflows).toEqual([
      ".github/workflows/release-layer-java.yml",
      ".github/workflows/release-layer-ruby.yml",
    ]);
  });

  test("aggregates no-job findings across workflows when they point at the same source location", () => {
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

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.locations).toEqual(["package.json:130:5"]);
    expect(aggregated[0]?.workflows).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
    ]);
    expect(aggregated[0]?.jobs).toEqual([]);
  });

  test("aggregates timeout findings across workflows even when one workflow has multiple affected jobs", () => {
    const suggestion =
      "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.";
    const measurementHint =
      "Force or simulate a hung run and confirm the job is terminated at the configured timeout.";
    const findings: Diagnostic[] = [
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/publish-vscode.yml",
        location: { path: ".github/workflows/publish-vscode.yml", line: 15, column: 3 },
        message: 'Job "publish" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion,
        measurementHint,
        aiHandoff:
          'Review .github/workflows/publish-vscode.yml job "publish" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
        score: 80,
      },
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/publish.yml",
        location: { path: ".github/workflows/publish.yml", line: 34, column: 3 },
        message: 'Job "version" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion,
        measurementHint,
        aiHandoff:
          'Review .github/workflows/publish.yml job "version" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
        score: 79,
      },
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/publish.yml",
        location: { path: ".github/workflows/publish.yml", line: 550, column: 3 },
        message: 'Job "publish" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion,
        measurementHint,
        aiHandoff:
          'Review .github/workflows/publish.yml job "publish" and add a sensible timeout-minutes value without breaking legitimate long-running work.',
        score: 78,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.workflows).toEqual([
      ".github/workflows/publish-vscode.yml",
      ".github/workflows/publish.yml",
    ]);
    expect(aggregated[0]?.jobs).toEqual(["publish", "version"]);
    expect(aggregated[0]?.locations).toEqual([
      ".github/workflows/publish-vscode.yml:15:3",
      ".github/workflows/publish.yml:34:3",
      ".github/workflows/publish.yml:550:3",
    ]);
  });

  test("keeps timeout findings separate when verification guidance differs", () => {
    const suggestion =
      "Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.";
    const findings: Diagnostic[] = [
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: ".github/workflows/ci.yml", line: 12, column: 3 },
        message: 'Job "test" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion,
        measurementHint: "Force or simulate a hung run and confirm it times out.",
        aiHandoff:
          'Review .github/workflows/ci.yml job "test" and add a sensible timeout-minutes value.',
        score: 80,
      },
      {
        ruleId: "missing-timeout-minutes",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/missing-timeout-minutes.md",
        workflow: ".github/workflows/release.yml",
        location: { path: ".github/workflows/release.yml", line: 18, column: 3 },
        message: 'Job "publish" does not define job-level timeout-minutes.',
        why: "Hung jobs can waste runner time.",
        suggestion,
        measurementHint: "Check recent release duration before choosing a timeout.",
        aiHandoff:
          'Review .github/workflows/release.yml job "publish" and add a sensible timeout-minutes value.',
        score: 79,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(2);
    expect(aggregated.map((finding) => finding.measurementHint)).toEqual([
      "Force or simulate a hung run and confirm it times out.",
      "Check recent release duration before choosing a timeout.",
    ]);
  });

  test("aggregates blob-none metadata findings across workflows", () => {
    const suggestion =
      "If this job mostly needs commit history, tags, and release metadata rather than repository file contents, keep the same depth and test checkout with `filter: blob:none`.";
    const measurementHint =
      "Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.";
    const findings: Diagnostic[] = [
      {
        ruleId: "consider-filter-blob-none-for-release-metadata",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/consider-filter-blob-none-for-release-metadata.md",
        workflow: ".github/workflows/docs-update.yml",
        location: { path: ".github/workflows/docs-update.yml", line: 23, column: 11 },
        message:
          'Job "update-docs" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.',
        why: "This path appears to focus on metadata.",
        suggestion,
        measurementHint,
        aiHandoff:
          'Review .github/workflows/docs-update.yml job "update-docs" and test whether checkout can use filter: blob:none while preserving its commit, tag, release-notes, or versioning behavior.',
        score: 68,
      },
      {
        ruleId: "consider-filter-blob-none-for-release-metadata",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/consider-filter-blob-none-for-release-metadata.md",
        workflow: ".github/workflows/publish.yml",
        location: { path: ".github/workflows/publish.yml", line: 40, column: 11 },
        message:
          'Job "version" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.',
        why: "This path appears to focus on metadata.",
        suggestion,
        measurementHint,
        aiHandoff:
          'Review .github/workflows/publish.yml job "version" and test whether checkout can use filter: blob:none while preserving its commit, tag, release-notes, or versioning behavior.',
        score: 67,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.workflows).toEqual([
      ".github/workflows/docs-update.yml",
      ".github/workflows/publish.yml",
    ]);
    expect(aggregated[0]?.jobs).toEqual(["update-docs", "version"]);
  });

  test("keeps blob-none metadata findings separate when suggested actions differ", () => {
    const measurementHint =
      "Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.";
    const findings: Diagnostic[] = [
      {
        ruleId: "consider-filter-blob-none-for-release-metadata",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/consider-filter-blob-none-for-release-metadata.md",
        workflow: ".github/workflows/docs-update.yml",
        location: { path: ".github/workflows/docs-update.yml", line: 23, column: 11 },
        message:
          'Job "update-docs" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.',
        why: "This path appears to focus on metadata.",
        suggestion: "Test checkout with `filter: blob:none` while keeping the same fetch depth.",
        measurementHint,
        aiHandoff:
          'Review .github/workflows/docs-update.yml job "update-docs" and test checkout filter: blob:none.',
        score: 68,
      },
      {
        ruleId: "consider-filter-blob-none-for-release-metadata",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/consider-filter-blob-none-for-release-metadata.md",
        workflow: ".github/workflows/publish.yml",
        location: { path: ".github/workflows/publish.yml", line: 40, column: 11 },
        message:
          'Job "version" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.',
        why: "This path appears to focus on metadata.",
        suggestion: "Keep the current checkout behavior until release versioning is measured.",
        measurementHint,
        aiHandoff:
          'Review .github/workflows/publish.yml job "version" and test checkout filter: blob:none.',
        score: 67,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(2);
    expect(aggregated.map((finding) => finding.suggestion)).toEqual([
      "Test checkout with `filter: blob:none` while keeping the same fetch depth.",
      "Keep the current checkout behavior until release versioning is measured.",
    ]);
  });

  test("deduplicates repeated repository findings while preserving first occurrence order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            path: fc.stringMatching(/^src\/[a-z]{1,8}\.ts$/),
            line: fc.integer({ min: 1, max: 200 }),
            column: fc.integer({ min: 1, max: 40 }),
          }),
          {
            minLength: 1,
            maxLength: 8,
            selector: (location) => `${location.path}:${location.line}:${location.column}`,
          },
        ),
        (locations) => {
          const findings = locations.flatMap((location) => [
            repositoryFinding(location),
            repositoryFinding(location),
          ]);
          const expectedMessages = [
            ...new Set(
              locations.map(
                (location) =>
                  `Embedded Oxlint scan flagged an extensionless import in ${location.path}.`,
              ),
            ),
          ];

          const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

          expect(aggregated).toHaveLength(1);
          expect(aggregated[0]?.firstIndex).toBe(0);
          expect(aggregated[0]?.locations).toEqual(
            locations.map((location) => `${location.path}:${location.line}:${location.column}`),
          );
          expect(aggregated[0]?.messages).toEqual(expectedMessages);
        },
      ),
    );
  });

  test("preserves earliest firstIndex when repository and workflow findings merge", () => {
    const findings: Diagnostic[] = [
      {
        ruleId: "prefer-node-run-over-npm-run",
        severity: "warning",
        confidence: "medium",
        scope: "repository",
        docsPath: "docs/rules/prefer-node-run-over-npm-run.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: "package.json", line: 1, column: 1 },
        message: "Repository-wide finding.",
        why: "Reason.",
        suggestion: "Use `bun x`.",
        measurementHint: "Measure it.",
        aiHandoff: "Handoff.",
        score: 80,
      },
      {
        ruleId: "prefer-node-run-over-npm-run",
        severity: "warning",
        confidence: "medium",
        docsPath: "docs/rules/prefer-node-run-over-npm-run.md",
        workflow: ".github/workflows/ci.yml",
        location: { path: ".github/workflows/ci.yml", line: 10, column: 3 },
        message: 'Job "build" has an issue.',
        why: "Reason.",
        suggestion: "Use `bun x`.",
        measurementHint: "Measure it.",
        aiHandoff: "Handoff.",
        score: 70,
      },
    ];

    const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.firstIndex).toBe(0);
  });

  test("merges timeout findings across workflows with unique jobs and workflow lists", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z]{3,8}$/), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.uniqueArray(fc.stringMatching(/^[a-z]{3,8}$/), {
          minLength: 1,
          maxLength: 6,
        }),
        (workflowNames, jobNames) => {
          const findings = workflowNames.map((workflowName, index) =>
            timeoutFinding(
              `.github/workflows/${workflowName}.yml`,
              jobNames[index % jobNames.length] ?? "build",
              index + 1,
              100 - index,
            ),
          );

          const aggregated = aggregateFindingsWithMembers(findings).aggregatedFindings;

          expect(aggregated).toHaveLength(1);
          expect(aggregated[0]?.workflows).toEqual(
            workflowNames.map((workflowName) => `.github/workflows/${workflowName}.yml`),
          );
          expect(aggregated[0]?.jobs).toEqual(
            jobNames
              .filter((jobName, index) => jobNames.indexOf(jobName) === index)
              .slice(0, workflowNames.length),
          );
          expect(aggregated[0]?.locations).toEqual(
            workflowNames.map(
              (workflowName, index) => `.github/workflows/${workflowName}.yml:${index + 1}:3`,
            ),
          );
        },
      ),
    );
  });
});
