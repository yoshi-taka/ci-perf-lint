import type { RuleMeta, Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import {
  workflowHasPushTrigger,
  workflowHasPullRequestTrigger,
} from "./shared/workflow-triggers.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const npmAuditPattern = /\bnpm\s+audit\b/i;

const securityWorkflowName =
  /\b(security|audit|vulnerability|dependabot|snyk|trivy|secret|scan)\b/i;

const meta = {
  id: "npm-audit-in-ci",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/npm-audit-in-ci.md",
  maxFindings: 3,
} satisfies RuleMeta;

export const npmAuditInCiRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    if (!workflowHasPushTrigger(workflow) && !workflowHasPullRequestTrigger(workflow)) {
      return [];
    }

    const name = workflow.name?.toLowerCase() ?? "";
    if (securityWorkflowName.test(name)) {
      return [];
    }

    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (!npmAuditPattern.test(run)) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Step "${step.name ?? job.id}" runs \`npm audit\` on every push or PR.`,
            why: "npm audit queries the registry on every run and rarely produces actionable signal for routine CI. Renovate, Dependabot, and vendor security tools (Snyk, Trivy, etc.) provide better coverage without per-PR overhead.",
            suggestion:
              "Use Renovate or Dependabot for dependency advisories instead of npm audit in CI.",
            measurementHint:
              "Check the run duration of npm audit steps — it adds latency proportional to lockfile size even when no advisories exist.",
            aiHandoff: `Remove \`npm audit\` from ${workflow.relativePath} step "${step.name ?? job.id}" and move it to a scheduled security workflow if needed.`,
            score: 30,
          }),
        );
      }
    }

    return findings;
  },
};
