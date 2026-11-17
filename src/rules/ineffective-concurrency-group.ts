import type { WorkflowDocument } from "../workflow.ts";
import { getNode } from "../workflow.ts";
import { isMap, type Node } from "../yaml.ts";
import type { RuleMeta } from "../types.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { workflowFact } from "./shared/predicate.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";

const meta = {
  id: "ineffective-concurrency-group",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/ineffective-concurrency-group.md",
  skipIf: workflowFact("isHeavyWorkflow", false),
} satisfies RuleMeta;

// Deliberately not an expression evaluator: conditional fallbacks, function
// calls and unknown inputs must not be mistaken for unconditional run IDs.
function uniqueRunExpression(node: Node | undefined): string | undefined {
  if (!node || !isMap(node)) {
    return undefined;
  }
  const cancel = getNode(node, "cancel-in-progress")?.toJSON();
  if (cancel !== true && cancel !== "${{ true }}") {
    return undefined;
  }
  const group = getNode(node, "group")?.toJSON();
  if (typeof group !== "string") {
    return undefined;
  }
  for (const match of group.matchAll(/\$\{\{([^{}]*)\}\}/g)) {
    const expression = match[1]?.replace(/\s+/g, "").toLowerCase();
    if (expression === "github.run_id" || expression === "github.run_number") {
      return expression;
    }
    // github.pull_request is not a GitHub context property; an absent
    // property is empty, so this real-world typo always takes the fallback.
    if (/^github\.pull_request\.number\|\|github\.run_(?:id|number)$/.test(expression ?? "")) {
      return expression;
    }
  }
  return undefined;
}

function acceptsPrUpdates(workflow: WorkflowDocument): boolean {
  if (!getTriggerSemantics(workflow).hasPullRequest) {
    return false;
  }
  const on = workflow.on;
  if (!on || typeof on !== "object" || Array.isArray(on)) {
    return true;
  }
  const pr = (on as Record<string, unknown>).pull_request;
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
    return true;
  }
  const types = (pr as Record<string, unknown>).types;
  return types === undefined || (Array.isArray(types) && types.includes("synchronize"));
}

export const ineffectiveConcurrencyGroupRule = {
  meta,
  check(workflow: WorkflowDocument) {
    if (!acceptsPrUpdates(workflow)) {
      return [];
    }
    const top = workflow.concurrencyNode;
    const topExpression = uniqueRunExpression(top);
    // An existing outer group may protect jobs. Unknown expressions are not
    // proof of missing protection (notably OpenMapX's event-specific groups).
    if (top && !topExpression) {
      return [];
    }

    const candidates = topExpression
      ? workflow.jobs.some(
          (job) => !job.concurrencyNode || uniqueRunExpression(job.concurrencyNode),
        )
        ? [{ node: top, expression: topExpression, label: "Workflow" }]
        : []
      : workflow.jobs.flatMap((job) => {
          const expression = uniqueRunExpression(job.concurrencyNode);
          return expression
            ? [{ node: job.concurrencyNode, expression, label: `Job "${job.id}"` }]
            : [];
        });

    return candidates.map(({ node, expression, label }) =>
      buildDiagnostic(workflow, meta, node && isMap(node) ? getNode(node, "group") : node, {
        message: `${label} concurrency uses a run-specific group despite cancel-in-progress: true.`,
        why: `The expression "${expression}" gives each new run a different group, so this setting cannot cancel superseded PR runs. Older builds and tests can keep occupying runners.`,
        suggestion:
          "If newer PR commits should replace older validation, use a workflow- and PR-scoped group such as github.workflow plus github.event.pull_request.number. Preserve intentionally independent runs and matrix identities.",
        measurementHint:
          "Update the same PR while validation is running; confirm the older run is cancelled without cancelling another PR or another matrix leg.",
        aiHandoff: `Review concurrency in ${workflow.relativePath}. Use github.event.pull_request.number (not github.pull_request.number), preserve non-PR behavior, and verify cancellation across two PR updates.`,
        score: 60,
      }),
    );
  },
};
