import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { shellCommandSegments } from "./shared/command-patterns.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-workflow-dispatch-run-details",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-workflow-dispatch-run-details.md",
} satisfies RuleMeta;

// Match direct gh commands and simple assignments containing command substitutions,
// but not examples printed by echo/printf or embedded in comments.
const GH_COMMAND = /^(?:[A-Za-z_][\w]*=["']?\$\(\s*)?gh\s+/;
const RUN_LIST_ENDPOINT = /\/actions\/(?:workflows\/[^\s"'?]+\/)?runs(?=[?"'\s]|$)/;
const RUN_ID = /\.id\b|\bdatabaseId\b/;

type DispatchKind = "api" | "cli";

interface DiscoveryLoop {
  afterDispatch?: DispatchKind;
  sleeps: boolean;
  listsRunIds: boolean;
}

function pollsForDispatchedRun(text: string): DispatchKind | undefined {
  let afterDispatch: DispatchKind | undefined;
  const loops: DiscoveryLoop[] = [];
  // The segment helper handles quoted arguments, but not nested quotes inside
  // a double-quoted command substitution. Remove only the assignment wrapper.
  const commands = text.replace(
    /(^|\n)(\s*[A-Za-z_]\w*=)"(\$\([\s\S]*?\))"(?=\s*(?:#.*)?(?:\n|$))/g,
    "$1$2$3",
  );

  for (const segment of shellCommandSegments(commands)) {
    let command = segment;
    if (/^(?:for|while|until)\s/.test(command)) {
      loops.push({ afterDispatch, sleeps: false, listsRunIds: false });
    }
    if (/^done\b/.test(command)) {
      const loop = loops.pop();
      if (loop?.afterDispatch && loop.sleeps && loop.listsRunIds) {
        return loop.afterDispatch;
      }
      continue;
    }
    command = command.replace(/^do\s+/, "");

    if (
      GH_COMMAND.test(command) &&
      /\bgh\s+api\s/.test(command) &&
      /\/actions\/workflows\/[^\s"']+\/dispatches\b/.test(command)
    ) {
      // Keep compatibility fallbacks when the dispatcher already requests details.
      afterDispatch = /return_run_details["']?\s*(?:=|:)\s*(?:true|["']true["'])/.test(command)
        ? undefined
        : "api";
    } else if (GH_COMMAND.test(command) && /\bgh\s+workflow\s+run\b/.test(command)) {
      // A captured URL may be followed by an intentional compatibility fallback.
      afterDispatch = /^gh\s+workflow\s+run\b/.test(command) ? "cli" : undefined;
    }

    const loop = loops.at(-1);
    if (!loop) {
      continue;
    }
    loop.sleeps ||= /^sleep\s/.test(command);
    loop.listsRunIds ||=
      GH_COMMAND.test(command) &&
      RUN_ID.test(command) &&
      (/\bgh\s+run\s+list\b/.test(command) ||
        (/\bgh\s+api\s/.test(command) && RUN_LIST_ENDPOINT.test(command)));
  }
  return undefined;
}

function usesLegacyLasithDiscovery(step: WorkflowStep): boolean {
  return (
    /^lasith-kg\/dispatch-workflow@v2(?:\.\d+){0,2}$/i.test(step.uses ?? "") &&
    step.with?.["dispatch-method"] === "workflow_dispatch" &&
    (step.with.discover === true || step.with.discover === "true")
  );
}

export const preferWorkflowDispatchRunDetailsRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (usesLegacyLasithDiscovery(step)) {
          findings.push(
            buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
              message: `${step.uses} discovers a workflow_dispatch run ID using legacy polling in job "${job.id}".`,
              why: "lasith-kg/dispatch-workflow v3 reads workflow_dispatch run details directly from the API response instead of injecting a distinct ID and polling run listings. This removes discovery delays and API requests.",
              suggestion:
                "Upgrade lasith-kg/dispatch-workflow to v3, preserving discover: true and downstream run-id/run-url consumers. Verify Node 24 action support on self-hosted runners and run-details support on the target GitHub host. Upgrade the parent first, then review whether the child's distinct_id input and run-name workaround are still needed by other callers.",
              measurementHint:
                "Compare dispatch-to-run-ID latency and discovery API requests before and after the action upgrade; retain completion waiting.",
              aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade only its workflow_dispatch discovery action from lasith v2 to v3 after compatibility checks. Preserve inputs, ref, token, step ID, discover setting, and output consumers; keep repository_dispatch discovery unchanged.`,
              score: 45,
            }),
          );
          continue;
        }
        const dispatchKind = step.run ? pollsForDispatchedRun(step.run) : undefined;
        if (!dispatchKind) {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" polls run listings with sleep after a workflow dispatch to discover a run ID.`,
            why: "The workflow dispatch API can return the created run ID directly. Sleeping and searching run listings to identify it adds avoidable discovery latency and API requests, and can select an unrelated concurrent run.",
            suggestion:
              dispatchKind === "cli"
                ? "Use gh 2.87.0 or later and capture the URL returned by gh workflow run in non-interactive execution, then derive the run ID from that URL instead of searching run listings. Alternatively use gh api .../dispatches -F return_run_details=true --jq '.workflow_run_id'. Verify host compatibility and preserve completion waiting."
                : "Request return_run_details with the dispatch and read workflow_run_id from its response, for example gh api .../dispatches -F return_run_details=true --jq '.workflow_run_id'. Verify the target GitHub host supports run details; preserve polling that waits for the known run to complete.",
            measurementHint:
              "Compare time and API request count from dispatch to obtaining the run ID. Completion waiting and downstream execution time are separate costs.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and replace only the run-ID discovery loop with the workflow dispatch response. Preserve the dispatched ref, inputs, authentication, failure handling, and completion wait. Check GitHub Enterprise Server compatibility before removing a fallback.`,
            score: 45,
          }),
        );
      }
    }
    return findings;
  },
};
