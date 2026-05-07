import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "missing-timeout-in-minutes-buildkite",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-timeout-in-minutes-buildkite.md",
  scope: "buildkite",
} satisfies RuleMeta;

function stepLooksHeavy(step: PipelineStep): boolean {
  const text =
    `${step.label ?? ""} ${step.command ?? ""} ${(step.commands ?? []).join(" ")}`.toLowerCase();
  return /(build|publish|release|deploy|upload|npm|pnpm|yarn|bun|cargo|gradle|maven|pytest|jest|vitest|tauri|electron|docker|test|lint)/.test(
    text,
  );
}

function stepHasTimeout(step: PipelineStep): boolean {
  return step.timeoutNode !== undefined;
}

export const missingTimeoutInMinutesBuildkiteRule = {
  meta,
  check(pipeline: PipelineDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const step of pipeline.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
        continue;
      }

      if (step.skip === true || step.skip === "true") {
        continue;
      }

      if (!stepHasTimeout(step) && stepLooksHeavy(step)) {
        const node = step.labelNode ?? step.commandNode ?? step.node;
        findings.push(
          buildDiagnostic(pipeline, meta, node, {
            severity: "warning",
            message: `Step "${step.label ?? step.key ?? "unnamed"}" does not define timeout_in_minutes.`,
            why: "Buildkite has no default timeout. Without timeout_in_minutes, a hung or degraded step can run indefinitely and consume agent capacity.",
            suggestion: `Add timeout_in_minutes to the step to prevent unbounded execution.`,
            measurementHint:
              "Monitor the step's typical duration and set timeout_in_minutes to a value that allows for normal variance but catches hangs.",
            aiHandoff: `Review ${pipeline.relativePath} step "${step.label ?? step.key}" and add a sensible timeout_in_minutes value.`,
            score: 65,
          }),
        );
      }
    }

    return findings;
  },
};
