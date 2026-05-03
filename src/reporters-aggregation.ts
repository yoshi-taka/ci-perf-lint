import type { AggregatedFinding, Diagnostic } from "./types.ts";
import { mergeSingleJobCrossWorkflowEntries } from "./finding-grouping.ts";
import { extractQuotedJobName } from "./shared/message-parsing.ts";

type MutableAggregatedFinding = AggregatedFinding & {
  messageSet: Set<string>;
  aiHandoffSet: Set<string>;
  locationSet: Set<string>;
  workflowSet: Set<string>;
  jobSet: Set<string>;
  memberFindings: Diagnostic[];
};

function mergeCrossWorkflowAggregatedFindings<
  T extends AggregatedFinding & { memberFindings: Diagnostic[] },
>(findings: T[]): T[] {
  return mergeSingleJobCrossWorkflowEntries(
    findings,
    (finding) => [finding.ruleId, finding.suggestion, finding.measurementHint].join("::"),
    (target, source) => {
      mergeUniqueValues(target.workflows, source.workflows);
      mergeUniqueValues(target.locations, source.locations);
      mergeUniqueValues(target.messages, source.messages);
      target.aiHandoffs ??= [];
      source.aiHandoffs ??= [];
      mergeUniqueValues(target.aiHandoffs, source.aiHandoffs);
      mergeUniqueValues(target.jobs, source.jobs);
      target.memberFindings.push(...source.memberFindings);
    },
    (finding) =>
      finding.scope !== "repository" &&
      (finding.jobs.length >= 1 || (finding.jobs.length === 0 && finding.locations.length >= 1)),
  );
}

function createMutableAggregatedFinding(
  finding: Diagnostic,
  index: number,
  location: string,
  jobName?: string,
): MutableAggregatedFinding {
  return {
    ruleId: finding.ruleId,
    workflow: finding.workflow,
    workflows: finding.scope === "repository" ? [finding.workflow] : [],
    docsPath: finding.docsPath,
    scope: finding.scope,
    messages: [finding.message],
    aiHandoffs: [finding.aiHandoff],
    locations: [location],
    jobs: jobName ? [jobName] : [],
    why: finding.why,
    suggestion: finding.suggestion,
    measurementHint: finding.measurementHint,
    firstIndex: index,
    messageSet: new Set([finding.message]),
    aiHandoffSet: new Set([finding.aiHandoff]),
    locationSet: new Set([location]),
    workflowSet: new Set(finding.scope === "repository" ? [finding.workflow] : []),
    jobSet: new Set(jobName ? [jobName] : []),
    memberFindings: [finding],
  };
}

function toAggregatedFinding(
  finding: AggregatedFinding & { memberFindings: Diagnostic[] },
): AggregatedFinding {
  return {
    ruleId: finding.ruleId,
    workflow: finding.workflow,
    workflows: finding.workflows,
    docsPath: finding.docsPath,
    scope: finding.scope,
    messages: finding.messages,
    aiHandoffs: finding.aiHandoffs,
    locations: finding.locations,
    jobs: finding.jobs,
    why: finding.why,
    suggestion: finding.suggestion,
    measurementHint: finding.measurementHint,
    firstIndex: finding.firstIndex,
  };
}

function pushUniqueValue(values: string[], seen: Set<string>, value: string | undefined): void {
  if (value === undefined || seen.has(value)) {
    return;
  }

  seen.add(value);
  values.push(value);
}

function mergeUniqueValues(target: string[], source: string[]): void {
  const seen = new Set(target);
  for (const value of source) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    target.push(value);
  }
}

export function aggregateFindingsWithMembers(findings: Diagnostic[]): {
  aggregatedFindings: AggregatedFinding[];
  memberFindings: Diagnostic[][];
} {
  const repositoryGrouped = new Map<string, MutableAggregatedFinding>();
  const workflowGrouped = new Map<string, MutableAggregatedFinding>();

  function workflowFindingKey(workflow: string, ruleId: string): string {
    return `${workflow}\n${ruleId}`;
  }

  function repositoryFindingKey(ruleId: string, docsPath: string): string {
    return [ruleId, docsPath].join("\n");
  }

  findings.forEach((finding, index) => {
    const jobName = extractQuotedJobName(finding.message);
    const location = `${finding.location.path}:${finding.location.line}:${finding.location.column}`;
    if (finding.scope === "repository") {
      const existing =
        repositoryGrouped.get(repositoryFindingKey(finding.ruleId, finding.docsPath)) ??
        createMutableAggregatedFinding(finding, index, location, jobName);
      pushUniqueValue(existing.messages, existing.messageSet, finding.message);
      existing.aiHandoffs ??= [];
      pushUniqueValue(existing.aiHandoffs, existing.aiHandoffSet, finding.aiHandoff);
      pushUniqueValue(existing.locations, existing.locationSet, location);
      pushUniqueValue(existing.workflows, existing.workflowSet, finding.workflow);
      if (existing.firstIndex !== index) {
        existing.memberFindings.push(finding);
      }
      repositoryGrouped.set(repositoryFindingKey(finding.ruleId, finding.docsPath), existing);
      return;
    }

    const existing =
      workflowGrouped.get(workflowFindingKey(finding.workflow, finding.ruleId)) ??
      createMutableAggregatedFinding(finding, index, location, jobName);

    pushUniqueValue(existing.messages, existing.messageSet, finding.message);
    existing.aiHandoffs ??= [];
    pushUniqueValue(existing.aiHandoffs, existing.aiHandoffSet, finding.aiHandoff);
    pushUniqueValue(existing.workflows, existing.workflowSet, finding.workflow);
    pushUniqueValue(existing.locations, existing.locationSet, location);
    pushUniqueValue(existing.jobs, existing.jobSet, jobName);
    if (existing.firstIndex !== index) {
      existing.memberFindings.push(finding);
    }

    workflowGrouped.set(workflowFindingKey(finding.workflow, finding.ruleId), existing);
  });

  const grouped = [...repositoryGrouped.values(), ...workflowGrouped.values()];

  const merged = mergeCrossWorkflowAggregatedFindings(
    grouped.sort((left, right) => left.firstIndex - right.firstIndex),
  );

  return {
    aggregatedFindings: merged.map(toAggregatedFinding),
    memberFindings: merged.map((finding) => finding.memberFindings),
  };
}
