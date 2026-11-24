import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { PipelineDocument, PipelineStep } from "../buildkite-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { buildkitePluginBaseNames } from "./shared/buildkite-plugins.ts";

const meta = {
  id: "skip-checkout-on-annotation-steps",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/skip-checkout-on-annotation-steps.md",
  scope: "buildkite",
} satisfies RuleMeta;

/** The plugin downloads build artifacts and processes them in Docker;
 * it never reads the checked-out source tree. Other plugins were not
 * audited and may need the checkout, so they keep the default. */
const NO_CHECKOUT_NEEDED_PLUGINS = ["test-summary"];

function annotationOnlyStep(step: PipelineStep): boolean {
  if (step.command !== undefined || step.commands !== undefined) {
    return false;
  }
  const bases = buildkitePluginBaseNames(step);
  return bases.length > 0 && bases.every((base) => NO_CHECKOUT_NEEDED_PLUGINS.includes(base));
}

export const skipCheckoutOnAnnotationStepsRule = {
  meta,
  check(pipeline: PipelineDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];

    for (const step of pipeline.steps) {
      if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
        continue;
      }
      if (step.skip === true || step.skip === "true") {
        continue;
      }
      if (!annotationOnlyStep(step)) {
        continue;
      }
      const raw = step.node.toJSON() as Record<string, unknown>;
      if (raw.checkout !== undefined) {
        // The step already customizes checkout behavior.
        continue;
      }

      const label = step.label ?? step.key ?? "unnamed";
      findings.push(
        buildDiagnostic(pipeline, meta, step.labelNode ?? step.node, {
          message: `Step "${label}" never reads the repository and can skip the git checkout.`,
          why: "Buildkite checks out the repository before every step by default. An annotation step that only consumes build artifacts pays that cost for nothing.",
          suggestion:
            "Add a step-level checkout block with `skip: true` so the agent omits the git checkout phase for this step (requires an agent version that supports step-level checkout configuration).",
          measurementHint:
            "Compare the step's duration before and after. On agents that reuse the working directory the saving is seconds; on clean agents it is the full clone time.",
          aiHandoff: `Review ${pipeline.relativePath} step "${label}": add \`checkout: { skip: true }\` unless the step needs the source tree.`,
          score: 35,
        }),
      );
    }

    return findings;
  },
};
