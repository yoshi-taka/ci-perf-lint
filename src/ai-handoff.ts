import type { AggregatedFinding } from "./types.ts";

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

  if (entry.ruleId === "detected-large-barrel-file") {
    return `Review repeated detected-large-barrel-file findings across ${entry.locations.length} source/tooling locations, starting with ${renderedLocations}. Narrow broad \`export *\` barrels where they are not intentional public API or generated output, keep API boundaries explicit, prefer direct imports where possible, and evaluate adding \`no-barrel-file\` as a guardrail.`;
  }

  if (entry.ruleId === "prefer-explicit-import-extensions") {
    return `Review repeated prefer-explicit-import-extensions findings across ${entry.locations.length} source/tooling locations, starting with ${renderedLocations}. Add explicit runtime extensions to relative JavaScript and TypeScript imports so resolvers do not repeatedly probe candidate extensions and index files; leave package imports unchanged.`;
  }

  return `Review repeated ${entry.ruleId} repository-wide findings across ${entry.locations.length} source/tooling locations, starting with ${renderedLocations}. Apply one consistent fix pattern where appropriate.`;
}

const sharedAiHandoffInstruction =
  "Before making repository or workflow changes, inspect recent git history to understand change risk. Also review related pull requests and issues when available.";

export function buildAiHandoff(topAggregatedFindings: AggregatedFinding[]): string[] {
  const lines: string[] = [sharedAiHandoffInstruction];

  topAggregatedFindings.forEach((finding) => {
    const fallback = finding.aiHandoffs?.[0];

    if (finding.scope === "repository") {
      lines.push(
        renderRepositoryHandoffSummary({
          ruleId: finding.ruleId,
          locations: finding.locations,
          fallback,
        }),
      );
      return;
    }

    if (finding.workflows.length >= 2 && finding.jobs.length >= 1) {
      const renderedWorkflows = finding.workflows.map((workflow) => `\`${workflow}\``).join(", ");
      const renderedJobs = finding.jobs.map((job) => `"${job}"`).join(", ");
      lines.push(
        `Review repeated ${finding.ruleId} findings for jobs ${renderedJobs} across workflows ${renderedWorkflows}. Apply one consistent fix pattern where appropriate instead of treating each workflow separately.`,
      );
      return;
    }

    if (finding.workflows.length >= 2 && finding.locations.length === 1) {
      const renderedWorkflows = finding.workflows.map((workflow) => `\`${workflow}\``).join(", ");
      lines.push(
        `Review ${finding.locations[0]} for repeated ${finding.ruleId} findings surfaced across workflows ${renderedWorkflows}. Apply one consistent fix pattern where appropriate instead of treating each workflow separately.`,
      );
      return;
    }

    if (finding.jobs.length >= 2) {
      const renderedJobs = finding.jobs.map((job) => `"${job}"`).join(", ");
      lines.push(
        `Review ${finding.workflow} for repeated ${finding.ruleId} findings affecting jobs ${renderedJobs}. Apply one consistent fix pattern where appropriate instead of treating each job in isolation.`,
      );
      return;
    }

    lines.push(fallback ?? `Review ${finding.ruleId} and apply the suggested action.`);
  });

  return uniqueStrings(lines);
}
