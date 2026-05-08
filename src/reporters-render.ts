import path from "node:path";
import type {
  AggregatedFinding,
  Diagnostic,
  OutputFormat,
  RenderOptions,
  ReportData,
} from "./types.ts";

const maxRenderedAffectedLocations = 5;
const publicDocsBaseUrl = "https://ci-perf-lint.veritycost.com";

const ESC = "\x1b";

function osc8Url(url: string): string {
  return `${ESC}]8;;${url}${ESC}\\`;
}

function osc8Link(url: string, text: string): string {
  return `${osc8Url(url)}${text}${osc8Url("")}`;
}

function maybeHyperlink(url: string, text: string, options: RenderOptions): string {
  return options.hyperlinks ? osc8Link(url, text) : text;
}

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[90m",
  highlight: "\x1b[96m",
  code: "\x1b[92m",
  link: "\x1b[36m",
  warning: "\x1b[93m",
};

function withColor(code: string, text: string): string {
  return `${code}${text}${ansi.reset}`;
}

function maybeColor(code: string, text: string, options: RenderOptions): string {
  return options.colors ? withColor(code, text) : text;
}

const inlineCodeRe = /`([^`]+)`/g;
const quotedIdentRe = /"([\w@./-]+)"/g;

function highlightInlineCode(text: string, options: RenderOptions): string {
  if (!options.colors) {
    return text;
  }
  return text.replace(inlineCodeRe, (_m, code: string) => {
    return `\`${withColor(ansi.code, code)}\``;
  });
}

function highlightQuotedIdents(text: string, options: RenderOptions): string {
  if (!options.colors) {
    return text;
  }
  return text.replace(quotedIdentRe, (_m, ident: string) => {
    return `"${withColor(ansi.code, ident)}"`;
  });
}

function highlightMessage(text: string, options: RenderOptions): string {
  if (!options.colors) {
    return text;
  }
  const withPaths = text.replace(filePathRe, (_m, fp: string) => {
    return withColor(ansi.dim, fp);
  });
  return highlightQuotedIdents(highlightInlineCode(withPaths, options), options);
}

const filePathRe = /([\w./@-]+\/(?:[\w.-]+\.(?:ya?ml|json|ts|js|tsx|jsx|md|toml|lock|txt))\b)/g;

function hyperlinkFilePath(fp: string, options: RenderOptions): string {
  if (!options.hyperlinks || !options.cwd) {
    return withColor(ansi.dim, fp);
  }
  const absPath = path.resolve(options.cwd, fp);
  return osc8Link(`file://${absPath}`, withColor(ansi.dim, fp));
}

function highlightAiHandoff(text: string, options: RenderOptions): string {
  if (!options.colors) {
    return text;
  }
  const withPaths = text.replace(filePathRe, (_m, fp: string) => {
    return hyperlinkFilePath(fp, options);
  });
  return highlightQuotedIdents(highlightInlineCode(withPaths, options), options);
}

export function affectedLocationLimit(options: RenderOptions): number {
  return options.showAllLocations ? Number.POSITIVE_INFINITY : maxRenderedAffectedLocations;
}

export function renderBacktickedListWithRemainder(
  values: string[],
  limit = maxRenderedAffectedLocations,
  options?: RenderOptions,
): string {
  const visibleValues = values.slice(0, limit).map((value) => {
    const linked = hyperlinkLocationText(value, options);
    return `\`${linked}\``;
  });
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

function renderSourceLocation(finding: Diagnostic, options?: RenderOptions): string {
  const text = `${finding.location.path}:${finding.location.line}:${finding.location.column}`;
  return maybeFileLink(text, finding.location.path, finding.location.line, options);
}

function maybeFileLink(
  text: string,
  filePath: string,
  line: number,
  options?: RenderOptions,
): string {
  let linked = text;
  if (options?.hyperlinks && options.cwd) {
    const absPath = path.resolve(options.cwd, filePath);
    const url = `file://${absPath}#L${line}`;
    linked = osc8Link(url, text);
  }
  return maybeColor(ansi.dim, linked, options ?? {});
}

const locationPattern = /^(.+):(\d+):(\d+)$/;

function hyperlinkLocationText(locText: string, options?: RenderOptions): string {
  const opts = options ?? {};
  if (!opts.hyperlinks || !opts.cwd) {
    return maybeColor(ansi.dim, locText, opts);
  }
  const m = locText.match(locationPattern);
  if (!m) {
    return maybeColor(ansi.dim, locText, opts);
  }
  const absPath = path.resolve(opts.cwd, m[1]!);
  const url = `file://${absPath}#L${m[2]!}`;
  return osc8Link(url, maybeColor(ansi.dim, locText, opts));
}

function renderDocsLink(docsPath: string, options?: RenderOptions): string {
  const match = docsPath.match(/^docs\/rules\/(.+)\.md$/);
  if (!match) {
    const raw = options?.hyperlinks ? osc8Link(docsPath, docsPath) : docsPath;
    return maybeColor(ansi.link, raw, options ?? {});
  }

  const url = `${publicDocsBaseUrl}/rules/${match[1]}`;
  const raw = maybeHyperlink(url, url, options ?? {});
  return maybeColor(ansi.link, raw, options ?? {});
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

function renderNoFindingsSummary(report: ReportData, options?: RenderOptions): string[] {
  return [
    "No actionable findings in the current scan mode.",
    `Repo: ${report.targetPath}`,
    `Workflows scanned: ${report.workflowCount}`,
    `Scan time: ${report.scannedAt}`,
    "Next step: no workflow changes are suggested from this scan.",
    options?.colors
      ? `If you want advisory suggestions too, rerun with ${withColor(ansi.code, "--mode exploratory")}.`
      : "If you want advisory suggestions too, rerun with --mode exploratory.",
  ];
}

function renderFindingText(finding: Diagnostic, index?: number, options?: RenderOptions): string {
  const prefix = typeof index === "number" ? `${index + 1}. ` : "- ";
  const scopeNote = finding.scope === "repository" ? " [repository-wide source/tooling]" : "";
  const ruleId = maybeColor(ansi.highlight, finding.ruleId, options ?? {});

  return [
    `${prefix}${ruleId} (${renderSourceLocation(finding, options)})${scopeNote}`,
    `   ${highlightMessage(finding.message, options ?? {})}`,
    `   ${maybeColor(ansi.dim, "Why it matters:", options ?? {})} ${highlightMessage(finding.why, options ?? {})}`,
    `   ${maybeColor(ansi.dim, "Suggested action:", options ?? {})} ${highlightMessage(finding.suggestion, options ?? {})}`,
    `   ${maybeColor(ansi.dim, "Measurement hint:", options ?? {})} ${highlightMessage(finding.measurementHint, options ?? {})}`,
    `   ${maybeColor(ansi.dim, "Rule docs:", options ?? {})} ${renderDocsLink(finding.docsPath, options)}`,
  ].join("\n");
}

function renderText(report: ReportData, options: RenderOptions = {}): string {
  if (report.topAggregatedFindings.length === 0) {
    return renderNoFindingsSummary(report, options).join("\n");
  }

  const lines: string[] = [];

  const header = maybeColor(ansi.bold, "GitHub Actions Performance Lint", options);
  lines.push(header);
  lines.push(`Repository: ${report.targetPath}`);
  lines.push(`Workflows scanned: ${report.workflowCount}`);
  lines.push("");
  lines.push(maybeColor(ansi.bold, "Top findings:", options));
  report.topAggregatedFindings.forEach((finding, index) => {
    const prefix = `${index + 1}. `;
    const ruleId = maybeColor(ansi.highlight, finding.ruleId, options);
    const scopeNote = finding.scope === "repository" ? " [repository-wide source/tooling]" : "";
    const renderedLocation =
      finding.locations.length === 1
        ? (finding.locations[0] ?? "")
        : `${finding.locations[0] ?? ""} +${finding.locations.length - 1} more`;
    const context = highlightMessage(renderAggregatedContext(finding), options);
    lines.push(
      [
        `${prefix}${ruleId} (${hyperlinkLocationText(renderedLocation, options)})${scopeNote}`,
        `   ${context}`,
        `   ${maybeColor(ansi.dim, "Suggested action:", options)} ${highlightMessage(finding.suggestion, options)}`,
        `   ${maybeColor(ansi.dim, "Measurement hint:", options)} ${highlightMessage(finding.measurementHint, options)}`,
        `   ${maybeColor(ansi.dim, "Rule docs:", options)} ${renderDocsLink(finding.docsPath, options)}`,
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

function renderFindingsOnlyText(report: ReportData, options?: RenderOptions): string {
  if (report.findings.length === 0) {
    return "No findings in the current scan mode.";
  }

  return report.findings
    .map((finding, index) => renderFindingText(finding, index, options))
    .join("\n");
}

function renderMarkdown(report: ReportData, options: RenderOptions = {}): string {
  if (report.topAggregatedFindings.length === 0) {
    const lines = ["# GitHub Actions Performance Lint", ""];
    for (const line of renderNoFindingsSummary(report, options)) {
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
    return renderNoFindingsSummary(report, options).join("\n");
  }

  const lines: string[] = [];
  const topCount = options.topCount ?? report.topAggregatedFindings.length;
  const mode = options.mode ?? "strict";

  lines.push(
    maybeColor(ansi.bold, "Update this repository using the performance findings below.", options),
  );
  lines.push("");
  lines.push(
    maybeColor(
      ansi.dim,
      `Repo: ${report.targetPath} | Workflows: ${report.workflowCount} | Scan: ${report.scannedAt}`,
      options,
    ),
  );
  lines.push(
    `Scope of this handoff: top ${topCount} findings from ${mode} mode, sorted by score with deterministic tie-breakers, not the full finding list. Use --top <n> to change this.`,
  );
  const availabilityNote = renderTopAvailabilityNote(report, options);
  if (availabilityNote) {
    lines.push(availabilityNote);
  }
  lines.push("");
  lines.push(maybeColor(ansi.bold, "Before editing:", options));

  if (report.aiHandoff.length === 0) {
    lines.push("- No findings.");
  } else {
    report.aiHandoff.forEach((item) =>
      lines.push(`${maybeColor(ansi.dim, "-", options)} ${highlightAiHandoff(item, options)}`),
    );
  }

  lines.push("");
  lines.push(maybeColor(ansi.bold, "Address these findings first:", options));

  if (report.topAggregatedFindings.length === 0) {
    lines.push("- No findings.");
  } else {
    report.topAggregatedFindings.forEach((finding, index) => {
      const renderedLocations =
        finding.locations.length === 1
          ? (finding.locations[0] ?? "")
          : `${finding.locations[0] ?? ""} +${finding.locations.length - 1} more`;
      const ruleId = maybeColor(ansi.highlight, finding.ruleId, options);
      const num = maybeColor(ansi.warning, `${index + 1}.`, options);
      lines.push(
        `${num} ${ruleId} (${hyperlinkLocationText(renderedLocations, options)}, ${renderDocsLink(finding.docsPath, options)})`,
      );
      if (finding.scope === "repository") {
        lines.push(`   ${maybeColor(ansi.dim, "Scope:", options)} repository-wide source/tooling.`);
      }
      if (finding.scope === "repository" && finding.locations.length >= 2) {
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected locations:", options)} ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options), options)}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      } else if (finding.workflows.length >= 2 && finding.jobs.length >= 1) {
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected workflows:", options)} ${finding.workflows.map((wf) => `\`${maybeColor(ansi.dim, wf, options)}\``).join(", ")}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected locations:", options)} ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options), options)}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected jobs:", options)} ${finding.jobs.map((job) => `"${job}"`).join(", ")}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      } else if (finding.workflows.length >= 2) {
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected workflows:", options)} ${finding.workflows.map((wf) => `\`${maybeColor(ansi.dim, wf, options)}\``).join(", ")}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      } else if (finding.jobs.length >= 2) {
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected jobs:", options)} ${finding.jobs.map((job) => `"${job}"`).join(", ")}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      } else if (finding.scope !== "repository" && finding.locations.length >= 2) {
        lines.push(
          `   ${maybeColor(ansi.dim, "Affected locations:", options)} ${renderBacktickedListWithRemainder(finding.locations, affectedLocationLimit(options), options)}`,
        );
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      } else {
        lines.push(
          `   ${maybeColor(ansi.dim, "Context:", options)} ${highlightMessage(renderAggregatedContext(finding), options)}`,
        );
      }
      lines.push(
        `   ${maybeColor(ansi.dim, "Why it matters:", options)} ${highlightMessage(finding.why, options)}`,
      );
      lines.push(
        `   ${maybeColor(ansi.dim, "Suggested action:", options)} ${highlightMessage(finding.suggestion, options)}`,
      );
      lines.push(
        `   ${maybeColor(ansi.dim, "Verify:", options)} ${highlightMessage(finding.measurementHint, options)}`,
      );
    });
  }

  lines.push("");
  lines.push(maybeColor(ansi.bold, "Constraints:", options));
  lines.push("- Keep unrelated jobs and release/deployment behavior unchanged.");
  lines.push(
    "- Prefer minimal edits. If repo intent is unclear, confirm from git history or prior discussion first.",
  );
  lines.push("");
  lines.push(
    maybeColor(
      ansi.dim,
      "After editing: report what changed, which findings were addressed, which were deferred with reasons, and how you verified each change. Compare before/after using the measurement hints plus MCP, CI observability links, or logs when available.",
      options,
    ),
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
    const ruleId = maybeColor(ansi.highlight, finding.ruleId, options);
    lines.push(`${index + 1}. ${ruleId} at ${renderSourceLocation(finding, options)}`);
    if (finding.scope === "repository") {
      lines.push(`   ${maybeColor(ansi.dim, "Scope:", options)} repository-wide source/tooling.`);
    }
    lines.push(
      `   ${maybeColor(ansi.dim, "Message:", options)} ${highlightMessage(finding.message, options)}`,
    );
    lines.push(
      `   ${maybeColor(ansi.dim, "Why:", options)} ${highlightMessage(finding.why, options)}`,
    );
    lines.push(
      `   ${maybeColor(ansi.dim, "Suggested action:", options)} ${highlightMessage(finding.suggestion, options)}`,
    );
    lines.push(
      `   ${maybeColor(ansi.dim, "Measurement hint:", options)} ${highlightMessage(finding.measurementHint, options)}`,
    );
    lines.push(
      `   ${maybeColor(ansi.dim, "Rule docs:", options)} ${renderDocsLink(finding.docsPath, options)}`,
    );
  });

  return lines.join("\n");
}

export function renderReport(
  report: ReportData,
  format: OutputFormat,
  options: RenderOptions = {},
): string {
  if (format === "markdown" || format === "json") {
    const plainOptions: RenderOptions = {
      findingsOnly: options.findingsOnly,
      topCount: options.topCount,
      mode: options.mode,
      showAllLocations: options.showAllLocations,
    };
    if (options.findingsOnly) {
      switch (format) {
        case "json":
          return JSON.stringify(report.findings, null, 2);
        case "markdown":
        default:
          return renderFindingsOnlyMarkdown(report);
      }
    }
    switch (format) {
      case "json":
        return JSON.stringify(report, null, 2);
      case "markdown":
      default:
        return renderMarkdown(report, plainOptions);
    }
  }

  if (options.findingsOnly) {
    switch (format) {
      case "handoff":
        return renderFindingsOnlyHandoff(report, options);
      case "text":
      default:
        return renderFindingsOnlyText(report, options);
    }
  }

  switch (format) {
    case "handoff":
      return renderHandoff(report, options);
    case "text":
    default:
      return renderText(report, options);
  }
}
