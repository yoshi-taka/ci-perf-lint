import type { AggregatedFinding } from "./types.ts";
import { renderAiHandoff } from "./reification.ts";

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function renderRepresentativeLocations(locations: string[]): string {
  const visibleLocations = locations.slice(0, 5).map((location) => `\`${location}\``);
  const remainingCount = locations.length - visibleLocations.length;
  return remainingCount > 0
    ? `${visibleLocations.join(", ")}, +${remainingCount} more`
    : visibleLocations.join(", ");
}

function renderRepositoryHandoffSummary(entry: {
  ruleId: string;
  locations: string[];
  fallback?: string;
}): string {
  if (entry.locations.length <= 1 && entry.fallback) {
    return entry.fallback;
  }

  const renderedLocations = renderRepresentativeLocations(entry.locations);

  return `Review repeated ${entry.ruleId} findings across ${entry.locations.length} source/tooling locations, starting with ${renderedLocations}. Apply one consistent fix pattern where appropriate.`;
}

function renderStructuredWorkflowHandoff(finding: AggregatedFinding): string | undefined {
  if (!finding.repair) {
    return undefined;
  }

  const source = { kind: "workflow" as const, workflowPath: finding.workflow };
  return renderAiHandoff(finding.repair, finding.ruleId, source);
}

const sharedAiHandoffInstruction =
  "Before making repository or workflow changes, inspect recent git history to understand change risk. Also review related pull requests and issues when available.";

export function buildAiHandoff(topAggregatedFindings: AggregatedFinding[]): string[] {
  const lines: string[] = [sharedAiHandoffInstruction];

  for (const finding of topAggregatedFindings) {
    const structuredHandoff = renderStructuredWorkflowHandoff(finding);

    if (structuredHandoff) {
      lines.push(structuredHandoff);
      continue;
    }

    const fallback = finding.aiHandoffs?.[0];

    if (finding.scope === "repository") {
      lines.push(
        renderRepositoryHandoffSummary({
          ruleId: finding.ruleId,
          locations: finding.locations,
          fallback,
        }),
      );
      continue;
    }

    if (finding.workflows.length >= 2 && finding.jobs.length >= 1) {
      const renderedWorkflows = finding.workflows.map((w) => `\`${w}\``).join(", ");
      const renderedJobs = finding.jobs.map((j) => `"${j}"`).join(", ");
      lines.push(
        `Review repeated ${finding.ruleId} findings for jobs ${renderedJobs} across workflows ${renderedWorkflows}. Apply one consistent fix pattern where appropriate instead of treating each workflow separately.`,
      );
      continue;
    }

    if (finding.workflows.length >= 2 && finding.locations.length === 1) {
      const renderedWorkflows = finding.workflows.map((w) => `\`${w}\``).join(", ");
      lines.push(
        `Review ${finding.locations[0]} for repeated ${finding.ruleId} findings surfaced across workflows ${renderedWorkflows}. Apply one consistent fix pattern where appropriate instead of treating each workflow separately.`,
      );
      continue;
    }

    if (finding.jobs.length >= 2) {
      const renderedJobs = finding.jobs.map((j) => `"${j}"`).join(", ");
      lines.push(
        `Review ${finding.workflow} for repeated ${finding.ruleId} findings affecting jobs ${renderedJobs}. Apply one consistent fix pattern where appropriate instead of treating each job in isolation.`,
      );
      continue;
    }

    lines.push(fallback ?? `Review ${finding.ruleId} and apply the suggested action.`);
  }

  return uniqueStrings(lines);
}
