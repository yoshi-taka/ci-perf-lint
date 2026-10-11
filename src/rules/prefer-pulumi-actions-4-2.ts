import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument, type WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { getRunsOnSpec } from "./shared/runs-on-facts.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-pulumi-actions-4-2",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-pulumi-actions-4-2.md",
} satisfies RuleMeta;

function cliConstraint(step: WorkflowStep): string | undefined {
  const version = step.with?.["pulumi-version"];
  if (version === undefined) {
    return "^3";
  }
  if (typeof version !== "string" || version.includes("${{")) {
    return undefined;
  }
  const literal = version.trim();
  return literal === "^3" || /^v?\d+\.\d+\.\d+$/.test(literal) ? literal : undefined;
}

export const preferPulumiActions42Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const runner = getRunsOnSpec(job);
      const persistentRunner = runner.labels.includes("self-hosted") && !runner.usesContainer;
      const installedConstraints = new Set<string>();
      const offenders: WorkflowStep[] = [];
      for (const step of job.steps) {
        if (
          !step.uses?.toLowerCase().startsWith("pulumi/actions@") ||
          getScalarValue(step.node, "if") === false ||
          step.if?.trim() === "false"
        ) {
          continue;
        }
        const constraint = cliConstraint(step);
        if (!constraint) {
          continue;
        }
        if (
          cacheActionVersionIsBelow(step, "pulumi/actions", [4, 2, 0]) &&
          (persistentRunner || installedConstraints.has(constraint))
        ) {
          offenders.push(step);
        }
        if (step.if === undefined || getScalarValue(step.node, "if") === true) {
          installedConstraints.add(constraint);
        }
      }
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" can reuse an installed Pulumi CLI but pins pulumi/actions before v4.2.0: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "pulumi/actions v4.2.0 checks whether the runner's installed Pulumi CLI satisfies pulumi-version and skips both the CLI download and version lookup when it does. Repeated setup or a persistent self-hosted runner can benefit; a missing or incompatible CLI still requires installation. This does not accelerate resource deployment itself.",
          suggestion:
            "Upgrade pulumi/actions to v4.2.0 or a later compatible release while preserving pulumi-version, stack, command, credentials and deployment options. Confirm the existing CLI satisfies the constraint; a compatible installed CLI may be older than the newest matching release.",
          measurementHint:
            "Compare CLI setup duration and network downloads with the same installed CLI and version constraint. Verify the selected CLI version and preview/deployment behavior before adopting reuse.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade old pulumi/actions refs to v4.2.0 or later. Preserve CLI constraints and deployment inputs, verify which installed CLI is reused, and compare setup duration.`,
          score: 40,
        }),
      );
    }
    return findings;
  },
};
