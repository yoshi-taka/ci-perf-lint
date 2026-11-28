import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerBuildOptionValues } from "./shared/docker-build-commands.ts";
import { depotCommandArguments, depotUsesPersistentBuilder } from "./shared/depot-docker.ts";

const meta = {
  id: "depot-build-gha-cache-export",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/depot-build-gha-cache-export.md",
} satisfies RuleMeta;

/**
 * The type= parameter must be a literal gha token. Other parameters (for example
 * a dynamic scope) do not change the backend, so they are ignored here. A value
 * whose backend is an expression, or a registry/local/inline backend, is unknown.
 */
function hasGhaBackend(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return value.split(/[\r\n,]/).some((part) => /^type=gha$/i.test(part.trim()));
}

function usesDepotAction(step: WorkflowStep): boolean {
  return /^depot\/(?:build-push|bake)-action@/i.test(step.uses ?? "");
}

function actionGhaValues(step: WorkflowStep): string[] {
  if (!usesDepotAction(step) || !depotUsesPersistentBuilder(step)) {
    return [];
  }
  return ["cache-from", "cache-to"].map((name) => step.with?.[name]).filter(hasGhaBackend);
}

function commandGhaValues(step: WorkflowStep): string[] {
  return depotCommandArguments(step.run ?? "").flatMap((args) =>
    ["--cache-from", "--cache-to"].flatMap((name) =>
      dockerBuildOptionValues(args, name).filter(hasGhaBackend),
    ),
  );
}

export const depotBuildGhaCacheExportRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    return workflow.jobs.flatMap((job) => {
      if (job.usesReusableWorkflow) {
        return [];
      }
      const offenders = job.steps.filter(
        (step) => actionGhaValues(step).length > 0 || commandGhaValues(step).length > 0,
      );
      if (offenders.length === 0) {
        return [];
      }
      const first = offenders[0]!;
      const steps = offenders
        .map((step, index) => step.name ?? step.uses ?? (step.run ? `step ${index + 1}` : "step"))
        .join(", ");
      return [
        buildDiagnostic(
          workflow,
          meta,
          first.withNode ?? first.usesNode ?? first.runNode ?? first.node,
          {
            message: `Job "${job.id}" exports the GitHub Actions Docker cache from a Depot build (${steps}).`,
            why: "Depot builders persist the layer cache automatically. Exporting type=gha to those builders can conflict and produce `Our services aren't available right now` errors, and adds cache preparation and transfer work. Registry exports may be intentional for other consumers.",
            suggestion:
              "Remove the type=gha cache-from and cache-to entries so the build uses Depot's persistent layer cache. Keep an intentional registry cache and any consumer needed outside Depot.",
            measurementHint:
              "Rebuild after warm runs and compare build time, cache-hit output and export duration. Confirm no `Our services aren't available right now` error and that image publication and external cache consumers are unchanged.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and remove only the type=gha cache entries from the Depot build steps. Preserve push settings, tags, registry caches, buildx-fallback paths and any cache consumed outside Depot.`,
            score: 68,
          },
        ),
      ];
    });
  },
};
