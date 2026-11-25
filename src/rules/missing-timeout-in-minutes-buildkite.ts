import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellNonDisplayInvocations } from "./shared/shell-invocations.ts";
import {
  invocationWorkName,
  invocationHasNativeOrOpaqueWork,
} from "./shared/tooling-command-evidence.ts";
import { buildkitePluginWeight } from "./shared/buildkite-plugins.ts";

const meta = {
  id: "missing-timeout-in-minutes-buildkite",
  severity: "warning",
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
  const pluginDriven = Boolean(step.plugins?.length);
  const pluginWeight = pluginDriven ? buildkitePluginWeight(step) : "unknown";
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
    // Plugin steps are classified by plugin name: heavy plugins run real
    // work, light plugins only annotate, and unknown plugins fall back
    // to the step label as an auxiliary hint.
    (pluginDriven &&
      (pluginWeight === "heavy" ||
        (pluginWeight === "unknown" && heavyName.test(step.label ?? ""))))
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
            message: `Step "${step.label ?? step.key ?? "unnamed"}" does not define timeout_in_minutes.`,
            why: "No explicit step timeout is visible. Pipeline or organization defaults and maximums may already bound the whole job; those settings are not available in workflow YAML.",
            suggestion:
              "Check pipeline and organization timeout settings first. Add timeout_in_minutes only if the effective job limit is missing or unsuitable. A plugin's internal timeout may bound only one operation, not hooks or other commands; allow headroom above that internal limit.",
            measurementHint:
              "Monitor the step's typical duration and allow for normal variance. Plugin steps need headroom above the plugin's own internal limit.",
            aiHandoff: `Review effective pipeline/organization and plugin timeout coverage for ${pipeline.relativePath} step "${step.label ?? step.key}" before adding a step timeout.`,
            score: 65,
          }),
        );
      }
    }

    return findings;
  },
};
