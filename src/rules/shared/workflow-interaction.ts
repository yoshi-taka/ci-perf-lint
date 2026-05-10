import type { Diagnostic, RuleMeta } from "../../types.ts";
import type { WorkflowDocument } from "../../workflow.ts";

export interface ConcurrencyGroup {
  readonly raw: string;
  readonly cancelInProgress: boolean;
}

export interface ConcurrencyIdentity {
  readonly normalized: string;
  readonly hasRef: boolean;
  readonly hasWorkflow: boolean;
  readonly hasHeadRef: boolean;
  readonly hasEvent: boolean;
  readonly hasBranch: boolean;
  readonly hasExpression: boolean;
}

export interface WorkflowDependency {
  readonly source: string;
  readonly target: string;
  readonly kind: "workflow_run" | "workflow_call";
}

export interface ConcurrencyDomain {
  readonly groupText: string;
  readonly memberWorkflows: readonly string[];
  readonly hasCancelInProgress: boolean;
}

export interface RepairInteraction {
  readonly repairRuleId: string;
  readonly sourceWorkflow: string;
  readonly affectedWorkflow: string;
  readonly sharedGroup: string;
  readonly interaction: string;
}

const TEMPLATE_EXPR_PATTERN = /\$\{\{\s*([^}]+)\s*\}\}/g;

function classifyTemplateExpr(expr: string): string {
  const cleaned = expr.trim().toLowerCase();
  if (/github\.(?:ref_name|ref|head_ref|base_ref)/.test(cleaned)) {
    return "{ref}";
  }
  if (cleaned.includes("github.workflow")) {
    return "{workflow}";
  }
  if (cleaned.includes("github.event_name")) {
    return "{event}";
  }
  return "{expr}";
}

export function normalizeConcurrencyGroup(raw: string): ConcurrencyIdentity {
  let normalized = raw;
  let hasRef = false;
  let hasWorkflow = false;
  let hasHeadRef = false;
  let hasEvent = false;
  let hasBranch = false;

  TEMPLATE_EXPR_PATTERN.lastIndex = 0;
  normalized = normalized.replace(TEMPLATE_EXPR_PATTERN, (_match, expr: string) => {
    const cls = classifyTemplateExpr(expr);
    if (cls === "{ref}") {
      hasRef = true;
      hasBranch = true;
    } else if (cls === "{workflow}") {
      hasWorkflow = true;
    } else if (cls === "{event}") {
      hasEvent = true;
    }
    return cls;
  });

  normalized = normalized.replace(/\s+/g, "-").replace(/-+/g, "-").toLowerCase();

  return {
    normalized,
    hasRef,
    hasWorkflow,
    hasHeadRef,
    hasBranch,
    hasEvent,
    hasExpression: normalized.includes("{"),
  };
}

export function concurrencyGroupsEqual(a: ConcurrencyIdentity, b: ConcurrencyIdentity): boolean {
  return a.normalized === b.normalized;
}

export function parseConcurrencyGroup(workflow: WorkflowDocument): ConcurrencyGroup | undefined {
  if (!workflow.concurrencyNode) {
    return undefined;
  }
  const parsed = workflow.parsed;
  if (!parsed) {
    return undefined;
  }
  const concurrencyValue = parsed.concurrency;
  if (typeof concurrencyValue === "string") {
    return { raw: concurrencyValue, cancelInProgress: false };
  }
  if (concurrencyValue && typeof concurrencyValue === "object") {
    const group = (concurrencyValue as Record<string, unknown>).group;
    const cancelInProgress = Boolean(
      (concurrencyValue as Record<string, unknown>)["cancel-in-progress"],
    );
    if (typeof group === "string") {
      return { raw: group, cancelInProgress };
    }
  }
  return undefined;
}

export function findWorkflowDependencies(
  workflows: readonly WorkflowDocument[],
): WorkflowDependency[] {
  const deps: WorkflowDependency[] = [];

  for (const workflow of workflows) {
    const parsed = workflow.parsed;
    if (!parsed) {
      continue;
    }

    const on = parsed.on;
    if (!on || typeof on !== "object") {
      continue;
    }

    const onRecord = on as Record<string, unknown>;

    if (onRecord.workflow_run && typeof onRecord.workflow_run === "object") {
      const runCfg = onRecord.workflow_run as Record<string, unknown>;
      const workflows_ = runCfg.workflows;
      if (typeof workflows_ === "string") {
        const search = workflows_.toLowerCase();
        for (const candidate of workflows) {
          if (
            candidate.relativePath !== workflow.relativePath &&
            (candidate.name?.toLowerCase() === search ||
              candidate.relativePath.toLowerCase().includes(search))
          ) {
            deps.push({
              source: workflow.relativePath,
              target: candidate.relativePath,
              kind: "workflow_run",
            });
          }
        }
      }
    }

    if (onRecord.workflow_call) {
      const callers = workflows.filter(
        (w) =>
          w.relativePath !== workflow.relativePath &&
          w.jobs.some((job) =>
            job.steps.some((step) => {
              const uses = step.uses ?? "";
              return uses.includes(workflow.relativePath) || uses.includes(workflow.name ?? "");
            }),
          ),
      );
      for (const caller of callers) {
        deps.push({
          source: caller.relativePath,
          target: workflow.relativePath,
          kind: "workflow_call",
        });
      }
    }
  }

  return deps;
}

export function findWorkflowRunDependents(
  workflowPath: string,
  deps: WorkflowDependency[],
): string[] {
  return deps
    .filter((d) => d.target === workflowPath && d.kind === "workflow_run")
    .map((d) => d.source);
}

export function detectConcurrencyDomains(
  workflows: readonly WorkflowDocument[],
): ConcurrencyDomain[] {
  const domainMap = new Map<string, { members: string[]; cancel: boolean; groupText: string }>();

  for (const workflow of workflows) {
    const group = parseConcurrencyGroup(workflow);
    if (!group) {
      continue;
    }

    const identity = normalizeConcurrencyGroup(group.raw);
    const key = identity.normalized;

    let domain = domainMap.get(key);
    if (!domain) {
      domain = { members: [], cancel: group.cancelInProgress, groupText: identity.normalized };
      domainMap.set(key, domain);
    }
    domain.members.push(workflow.relativePath);
    if (group.cancelInProgress) {
      domain.cancel = true;
    }
  }

  return [...domainMap.entries()]
    .filter(([_, d]) => d.members.length > 1)
    .map(([_, d]) => ({
      groupText: d.groupText,
      memberWorkflows: [...d.members].sort(),
      hasCancelInProgress: d.cancel,
    }));
}

export function detectRepairInteractions(
  workflows: readonly WorkflowDocument[],
  findings: readonly Diagnostic[],
  deps: WorkflowDependency[],
): RepairInteraction[] {
  const interactions: RepairInteraction[] = [];

  const missingConcurrencyFindings = findings.filter((f) => f.ruleId === "missing-concurrency");
  if (missingConcurrencyFindings.length === 0) {
    return [];
  }

  const concurrencyDomains = detectConcurrencyDomains(workflows);

  for (const finding of missingConcurrencyFindings) {
    const workflowPath = finding.workflow;
    const dependents = findWorkflowRunDependents(workflowPath, deps);

    if (dependents.length === 0) {
      continue;
    }

    for (const domain of concurrencyDomains) {
      if (domain.memberWorkflows.includes(workflowPath)) {
        continue;
      }

      const dependentInDomain = dependents.filter((d) => domain.memberWorkflows.includes(d));
      if (dependentInDomain.length === 0) {
        continue;
      }

      interactions.push({
        repairRuleId: "missing-concurrency",
        sourceWorkflow: workflowPath,
        affectedWorkflow: dependentInDomain[0]!,
        sharedGroup: domain.groupText,
        interaction: `Adding concurrency to ${workflowPath} may share cancellation domain "${domain.groupText}" with dependent ${dependentInDomain.join(", ")}, causing unrelated executions to cancel each other`,
      });
    }

    const existingGroup = concurrencyDomains.find((d) => d.memberWorkflows.includes(workflowPath));
    if (existingGroup) {
      const dependentInDomain = dependents.filter((d) => existingGroup.memberWorkflows.includes(d));
      if (dependentInDomain.length > 0) {
        continue;
      }
    }

    for (const dep of dependents) {
      const depGroup = forWorkflow(dep, workflows);
      if (!depGroup) {
        continue;
      }

      const suggested = "${{ github.workflow }}-${{ github.ref }}";
      const suggestedIdent = normalizeConcurrencyGroup(suggested);
      const depIdent = normalizeConcurrencyGroup(depGroup.raw);

      if (concurrencyGroupsEqual(suggestedIdent, depIdent)) {
        interactions.push({
          repairRuleId: "missing-concurrency",
          sourceWorkflow: workflowPath,
          affectedWorkflow: dep,
          sharedGroup: depGroup.raw,
          interaction: `Adding concurrency to ${workflowPath} with a ref-scoped group may match existing group "${depGroup.raw}" in dependent ${dep}, causing unrelated executions to cancel each other`,
        });
      }
    }
  }

  return interactions;
}

function forWorkflow(
  path: string,
  workflows: readonly WorkflowDocument[],
): ConcurrencyGroup | undefined {
  const wf = workflows.find((w) => w.relativePath === path);
  return wf ? parseConcurrencyGroup(wf) : undefined;
}

export function buildRepairInteractionDiagnostics(
  workflows: readonly WorkflowDocument[],
  findings: readonly Diagnostic[],
  deps: WorkflowDependency[],
  meta: RuleMeta,
): Diagnostic[] {
  const interactions = detectRepairInteractions(workflows, findings, deps);
  return interactions.map((interaction, index) => ({
    ruleId: meta.id,
    severity: meta.severity,
    confidence: meta.confidence,
    scope: "repository" as const,
    docsPath: meta.docsPath,
    workflow: interaction.sourceWorkflow,
    location: { path: interaction.sourceWorkflow, line: 1, column: 1 },
    message: interaction.interaction,
    why: "Adding a concurrency group to a workflow that triggers dependent workflows via workflow_run can accidentally merge cancellation domains, causing independent runs to cancel each other.",
    suggestion:
      "Scope the concurrency group with a unique per-workflow prefix to avoid cross-workflow cancellation interference.",
    measurementHint:
      "After adding concurrency, verify that dependent workflow runs are not unexpectedly cancelled.",
    aiHandoff: `Review concurrency groups in ${interaction.sourceWorkflow} and its dependents (${interaction.affectedWorkflow}). Ensure each workflow uses a unique group prefix to prevent cross-workflow cancellation.`,
    score: Math.max(60, 85 - index * 5),
  }));
}
