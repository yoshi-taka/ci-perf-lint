import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellNonDisplayInvocations } from "./shared/shell-invocations.ts";
import {
  invocationWorkName,
  invocationHasNativeOrOpaqueWork,
} from "./shared/tooling-command-evidence.ts";

const meta = {
  id: "missing-timeout-in-minutes-buildkite",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/missing-timeout-in-minutes-buildkite.md",
  scope: "buildkite",
} satisfies RuleMeta;

function stepLooksHeavy(step: PipelineStep): boolean {
  const heavyName =
    /\b(build|publish|release|deploy|upload|npm|pnpm|yarn|bun|cargo|gradle|maven|pytest|jest|vitest|tauri|electron|docker|test|lint)\b/i;
  const source = [step.command ?? "", ...(step.commands ?? [])].join("\n");
  const commands = [
    ...shellNonDisplayInvocations(source),
    ...shellNonDisplayInvocations(source, true),
  ];
  return (
    commands.some((words) => {
      const [tool, action, subcommand] = words;
      if (tool === "buildkite-agent" && action === "pipeline" && subcommand === "upload") {
        return false;
      }
      if (["grep", "egrep", "fgrep", "test", "[", "[["].includes(tool ?? "")) {
        return false;
      }
      return (
        heavyName.test(invocationWorkName(words)) ||
        (["make", "just", "task"].includes(tool ?? "") && heavyName.test(action ?? "")) ||
        (invocationHasNativeOrOpaqueWork(words) && heavyName.test(step.label ?? ""))
      );
    }) ||
    (Boolean(step.plugins?.length) && heavyName.test(step.label ?? ""))
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
