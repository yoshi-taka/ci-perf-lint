import type {
  AggregatedFinding,
  Diagnostic,
  OutputFormat,
  RenderOptions,
  ReportData,
} from "./types.ts";

const maxRenderedAffectedLocations = 5;
const publicDocsBaseUrl = "https://ci-perf-lint.veritycost.com";

export function affectedLocationLimit(options: RenderOptions): number {
  return options.showAllLocations ? Number.POSITIVE_INFINITY : maxRenderedAffectedLocations;
}

export function renderBacktickedListWithRemainder(
  values: string[],
  limit = maxRenderedAffectedLocations,
): string {
  const visibleValues = values.slice(0, limit).map((value) => `\`${value}\``);
  const remainingCount = values.length - visibleValues.length;
  if (remainingCount > 0) {
    visibleValues.push(`+${remainingCount} more`);
  }
  return visibleValues.join(", ");
}

function renderTopAvailabilityNote(report: ReportData, options: RenderOptions): string | undefined {
  const requestedTopCount = options.topCount;
  if (
    typeof requestedTopCount !== "number" ||
    report.topAggregatedFindings.length === 0 ||
    report.topAggregatedFindings.length >= requestedTopCount
  ) {
    return undefined;
  }

  const findingLabel = report.topAggregatedFindings.length === 1 ? "finding" : "findings";
  return `Only ${report.topAggregatedFindings.length} ${findingLabel} available in this scan mode.`;
}

function renderSourceLocation(finding: Diagnostic): string {
  return `${finding.location.path}:${finding.location.line}:${finding.location.column}`;
}

function renderDocsLink(docsPath: string): string {
  const match = docsPath.match(/^docs\/rules\/(.+)\.md$/);
  if (!match) {
    return docsPath;
  }

  return `${publicDocsBaseUrl}/rules/${match[1]}/`;
}

function renderAggregatedContext(finding: AggregatedFinding): string {
  if (
    finding.ruleId === "prefer-explicit-import-extensions" &&
    finding.scope === "repository" &&
    finding.locations.length >= 2
  ) {
    return `prefer-explicit-import-extensions appears in ${finding.locations.length} source/tooling locations. These are relative imports without a runtime file extension, such as \`./foo\` instead of \`./foo.ts\` or \`./foo.tsx\`; resolvers must probe candidate extensions and index files repeatedly, which can slow large Vite-family dev startup, transforms, tests, and builds.`;
  }

  if (finding.scope === "repository" && finding.locations.length >= 2) {
    return `${finding.ruleId} appears in ${finding.locations.length} source/tooling locations; apply one consistent fix pattern where appropriate.`;
  }

  if (finding.workflows.length >= 2 && finding.jobs.length >= 1) {
    return `repeated ${finding.ruleId} findings across multiple workflows; apply one consistent fix pattern where appropriate.`;
  }

  if (finding.workflows.length >= 2) {
    return `repeated ${finding.ruleId} findings surfaced across multiple workflows; apply one consistent fix pattern where appropriate.`;
  }

  if (finding.jobs.length >= 2) {
    return `repeated ${finding.ruleId} findings in ${finding.workflow}; apply one consistent fix pattern where appropriate.`;
  }

  if (finding.locations.length >= 2) {
    return `repeated ${finding.ruleId} findings across ${finding.locations.length} locations; apply one consistent fix pattern where appropriate.`;
  }

  return finding.messages[0] ?? "";
}

function renderNoFindingsSummary(report: ReportData): string[] {
  return [
    "No actionable findings in the current scan mode.",
    `Repo: ${report.targetPath}`,
    `Workflows scanned: ${report.workflowCount}`,
    `Scan time: ${report.scannedAt}`,
    "Next step: no workflow changes are suggested from this scan.",
    "If you want advisory suggestions too, rerun with --mode exploratory.",
  ];
}

function renderFindingText(finding: Diagnostic, index?: number): string {
  const prefix = typeof index === "number" ? `${index + 1}. ` : "- ";
  const scopeNote = finding.scope === "repository" ? " [repository-wide source/tooling]" : "";

  return [
    `${prefix}${finding.ruleId} (${renderSourceLocation(finding)})${scopeNote}`,
    `   ${finding.message}`,
    `   Why it matters: ${finding.why}`,
    `   Suggested action: ${finding.suggestion}`,
    `   Measurement hint: ${finding.measurementHint}`,
    `   Rule docs: ${renderDocsLink(finding.docsPath)}`,
  ].join("\n");
}

function renderText(report: ReportData, options: RenderOptions = {}): string {
  if (report.topAggregatedFindings.length === 0) {
    return renderNoFindingsSummary(report).join("\n");
  }

  const lines: string[] = [];

  lines.push("GitHub Actions Performance Lint");
  lines.push(`Repository: ${report.targetPath}`);
  lines.push(`Workflows scanned: ${report.workflowCount}`);
  lines.push("");
  lines.push("Top findings:");
  report.topAggregatedFindings.forEach((finding, index) => {
    const prefix = `${index + 1}. `;
    const scopeNote = finding.scope === "repository" ? " [repository-wide source/tooling]" : "";
    const renderedLocation =
      finding.locations.length === 1
        ? finding.locations[0]
        : `${finding.locations[0]} +${finding.locations.length - 1} more`;
    const context = renderAggregatedContext(finding);
    lines.push(
      [
        `${prefix}${finding.ruleId} (${renderedLocation})${scopeNote}`,
        `   ${context}`,
        `   Suggested action: ${finding.suggestion}`,
        `   Measurement hint: ${finding.measurementHint}`,
        `   Rule docs: ${renderDocsLink(finding.docsPath)}`,
      ].join("\n"),
    );
  });
  const availabilityNote = renderTopAvailabilityNote(report, options);
  if (availabilityNote) {
    lines.push("");
    lines.push(availabilityNote);
  }

  return lines.join("\n");
}

function renderFindingsOnlyText(report: ReportData): string {
  if (report.findings.length === 0) {
    return "No findings in the current scan mode.";
  }

  return report.findings.map((finding, index) => renderFindingText(finding, index)).join("\n");
}

function renderMarkdown(report: ReportData, options: RenderOptions = {}): string {
  if (report.topAggregatedFindings.length === 0) {
    const lines = ["# GitHub Actions Performance Lint", ""];
    for (const line of renderNoFindingsSummary(report)) {
      lines.push(`- ${line}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [];

  lines.push("# GitHub Actions Performance Lint");
  lines.push("");
  lines.push(`- Repository: \`${report.targetPath}\``);
  lines.push(`- Workflows scanned: ${report.workflowCount}`);
  lines.push(`- Scan time: ${report.scannedAt}`);
  lines.push("");
  lines.push("## What To Fix First");
  lines.push("");

  report.fixFirst.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  const availabilityNote = renderTopAvailabilityNote(report, options);
  if (availabilityNote) {
    lines.push("");
    lines.push(`_${availabilityNote}_`);
  }

  lines.push("");
  lines.push("## Top Findings");
  lines.push("");

  report.topAggregatedFindings.forEach((finding) => {
    lines.push(`### ${finding.ruleId}`);
    lines.push("");
    if (finding.scope !== "repository") {
      lines.push(`- Workflow: \`${finding.workflow}\``);
    }
    lines.push(`- Location: \`${finding.locations[0]}\``);
    if (finding.scope === "repository") {
      lines.push("- Scope: `repository-wide source/tooling`");
    }
    if (finding.scope === "repository" && finding.locations.length >= 2) {
      lines.push(
        `- Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
      );
    }
    if (finding.workflows.length >= 2) {
      lines.push(
        `- Affected workflows: ${finding.workflows.map((workflow) => `\`${workflow}\``).join(", ")}`,
      );
      lines.push(
        `- Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
      );
    }
    if (finding.jobs.length >= 1) {
      lines.push(`- Affected jobs: ${finding.jobs.map((job) => `"${job}"`).join(", ")}`);
    }
    if (
      finding.locations.length >= 2 &&
      finding.scope !== "repository" &&
      finding.workflows.length < 2
    ) {
      lines.push(
        `- Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
      );
    }
    lines.push(`- Rule docs: \`${renderDocsLink(finding.docsPath)}\``);
    lines.push(`- Context: ${renderAggregatedContext(finding)}`);
    lines.push(`- Suggested action: ${finding.suggestion}`);
    lines.push(`- Measurement hint: ${finding.measurementHint}`);
    lines.push("");
  });

  lines.push("## AI Handoff");
  lines.push("");
  if (report.aiHandoff.length === 0) {
    lines.push("- No findings.");
  } else {
    report.aiHandoff.forEach((item) => lines.push(`- ${item}`));
  }

  return lines.join("\n");
}

function renderFindingsOnlyMarkdown(report: ReportData): string {
  const lines = ["# Findings", ""];

  if (report.findings.length === 0) {
    lines.push("- No findings in the current scan mode.");
    return lines.join("\n");
  }

  report.findings.forEach((finding) => {
    lines.push(`## ${finding.ruleId}`);
    lines.push("");
    if (finding.scope !== "repository") {
      lines.push(`- Workflow: \`${finding.workflow}\``);
    }
    lines.push(
      `- Location: \`${finding.location.path}:${finding.location.line}:${finding.location.column}\``,
    );
    lines.push(`- Severity: \`${finding.severity}\``);
    lines.push(`- Confidence: \`${finding.confidence}\``);
    if (finding.scope === "repository") {
      lines.push("- Scope: `repository-wide source/tooling`");
    }
    lines.push(`- Rule docs: \`${renderDocsLink(finding.docsPath)}\``);
    lines.push(`- Message: ${finding.message}`);
    lines.push(`- Why it matters: ${finding.why}`);
    lines.push(`- Suggested action: ${finding.suggestion}`);
    lines.push(`- Measurement hint: ${finding.measurementHint}`);
    lines.push("");
  });

  return lines.join("\n");
}

function renderHandoff(report: ReportData, options: RenderOptions): string {
  if (report.findings.length === 0) {
    return renderNoFindingsSummary(report).join("\n");
  }

  const lines: string[] = [];
  const topCount = options.topCount ?? report.topAggregatedFindings.length;
  const mode = options.mode ?? "strict";

  lines.push("Update this repository using the performance findings below.");
  lines.push("");
  lines.push(
    `Repo: ${report.targetPath} | Workflows: ${report.workflowCount} | Scan: ${report.scannedAt}`,
  );
  lines.push(
    `Scope of this handoff: top ${topCount} findings from ${mode} mode, sorted by score with deterministic tie-breakers, not the full finding list. Use --top <n> to change this.`,
  );
  const availabilityNote = renderTopAvailabilityNote(report, options);
  if (availabilityNote) {
    lines.push(availabilityNote);
  }
  lines.push("");
  lines.push("Before editing:");

  if (report.aiHandoff.length === 0) {
    lines.push("- No findings.");
  } else {
    report.aiHandoff.forEach((item) => lines.push(`- ${item}`));
  }

  lines.push("");
  lines.push("Address these findings first:");

  if (report.topAggregatedFindings.length === 0) {
    lines.push("- No findings.");
  } else {
    report.topAggregatedFindings.forEach((finding, index) => {
      const renderedLocations =
        finding.locations.length === 1
          ? finding.locations[0]
          : `${finding.locations[0]} +${finding.locations.length - 1} more`;
      lines.push(
        `${index + 1}. ${finding.ruleId} (${renderedLocations}, ${renderDocsLink(finding.docsPath)})`,
      );
      if (finding.scope === "repository") {
        lines.push("   Scope: repository-wide source/tooling.");
      }
      if (finding.scope === "repository" && finding.locations.length >= 2) {
        lines.push(
          `   Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
        );
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      } else if (finding.workflows.length >= 2 && finding.jobs.length >= 1) {
        lines.push(
          `   Affected workflows: ${finding.workflows.map((workflow) => `\`${workflow}\``).join(", ")}`,
        );
        lines.push(
          `   Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
        );
        lines.push(`   Affected jobs: ${finding.jobs.map((job) => `"${job}"`).join(", ")}`);
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      } else if (finding.workflows.length >= 2) {
        lines.push(
          `   Affected workflows: ${finding.workflows.map((workflow) => `\`${workflow}\``).join(", ")}`,
        );
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      } else if (finding.jobs.length >= 2) {
        lines.push(`   Affected jobs: ${finding.jobs.map((job) => `"${job}"`).join(", ")}`);
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      } else if (finding.scope !== "repository" && finding.locations.length >= 2) {
        lines.push(
          `   Affected locations: ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options))}`,
        );
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      } else {
        lines.push(`   Context: ${renderAggregatedContext(finding)}`);
      }
      lines.push(`   Why it matters: ${finding.why}`);
      lines.push(`   Suggested action: ${finding.suggestion}`);
      lines.push(`   Verify: ${finding.measurementHint}`);
    });
  }

  lines.push("");
  lines.push("Constraints:");
  lines.push("- Keep unrelated jobs and release/deployment behavior unchanged.");
  lines.push(
    "- Prefer minimal edits. If repo intent is unclear, confirm from git history or prior discussion first.",
  );
  lines.push("");
  lines.push(
    "After editing: report what changed, which findings were addressed, which were deferred with reasons, and how you verified each change. Compare before/after using the measurement hints plus MCP, CI observability links, or logs when available.",
  );

  return lines.join("\n");
}

function renderFindingsOnlyHandoff(report: ReportData, options: RenderOptions): string {
  if (report.findings.length === 0) {
    return "No findings in the current scan mode.";
  }

  const mode = options.mode ?? "strict";
  const lines = [`Findings: full finding list from ${mode} mode.`, ""];
  report.findings.forEach((finding, index) => {
    lines.push(`${index + 1}. ${finding.ruleId} at ${renderSourceLocation(finding)}`);
    if (finding.scope === "repository") {
      lines.push("   Scope: repository-wide source/tooling.");
    }
    lines.push(`   Message: ${finding.message}`);
    lines.push(`   Why: ${finding.why}`);
    lines.push(`   Suggested action: ${finding.suggestion}`);
    lines.push(`   Measurement hint: ${finding.measurementHint}`);
    lines.push(`   Rule docs: ${renderDocsLink(finding.docsPath)}`);
  });

  return lines.join("\n");
}

export function renderReport(
  report: ReportData,
  format: OutputFormat,
  options: RenderOptions = {},
): string {
  if (options.findingsOnly) {
    switch (format) {
      case "handoff":
        return renderFindingsOnlyHandoff(report, options);
      case "json":
        return JSON.stringify(report.findings, null, 2);
      case "markdown":
        return renderFindingsOnlyMarkdown(report);
      case "text":
      default:
        return renderFindingsOnlyText(report);
    }
  }

  switch (format) {
    case "handoff":
      return renderHandoff(report, options);
    case "json":
      return JSON.stringify(report, null, 2);
    case "markdown":
      return renderMarkdown(report, options);
    case "text":
    default:
      return renderText(report, options);
  }
}
