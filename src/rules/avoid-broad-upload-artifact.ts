import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "avoid-broad-upload-artifact",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-broad-upload-artifact.md",
} satisfies RuleMeta;

const BROAD_PATHS = new Set([".", "./", "**", "*"]);

function isBroadPath(value: unknown): boolean {
  if (typeof value === "string") {
    return BROAD_PATHS.has(value.trim());
  }
  if (Array.isArray(value)) {
    return value.some((v) => typeof v === "string" && BROAD_PATHS.has(v.trim()));
  }
  return false;
}

function isErrorGuard(ifExpression: string | undefined): boolean {
  if (!ifExpression) {
    return false;
  }
  const normalized = ifExpression
    .toLowerCase()
    .replace(/\$\{\{\s*/g, "")
    .replace(/\s*\}\}/g, "")
    .trim();

  // Only runs on failure, cancellation, or non-success
  if (normalized.includes("failure()") || normalized.includes("cancelled()")) {
    return true;
  }
  if (normalized.includes("!success()")) {
    return true;
  }

  return false;
}

export const avoidBroadUploadArtifactRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!step.uses || !step.uses.toLowerCase().startsWith("actions/upload-artifact@")) {
          continue;
        }

        const pathValue = step.with?.path;
        if (!isBroadPath(pathValue)) {
          continue;
        }

        // Skip steps that are clearly debug/error-only uploads
        if (isErrorGuard(step.if)) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
            message: `${step.uses} uses a broad path (${JSON.stringify(pathValue)}) without an error guard.`,
            why: "Uploading the entire working directory or a very broad glob unconditionally wastes artifact storage and slows uploads. Broad uploads are usually only justified when gathering debug artifacts after a failure.",
            suggestion:
              "Narrow the path to the specific files needed, or add an error guard such as `if: failure()` if this step is intended for debug artifacts.",
            measurementHint:
              "Compare artifact size and upload duration before and after narrowing the path.",
            aiHandoff: `Narrow the upload-artifact path in ${workflow.relativePath} or add an error guard if the step is for debug artifacts. Preserve unrelated behavior.`,
            score: 55,
          }),
        );
      }
    }

    return findings;
  },
};
