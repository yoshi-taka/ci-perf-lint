import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "native-dependency-may-fall-back-to-source-build",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/native-dependency-may-fall-back-to-source-build.md",
} satisfies RuleMeta;

function workflowHasSourceBuildSmell(workflow: WorkflowDocument): boolean {
  return workflow.jobs.some((job) =>
    job.steps.some((step) => {
      const text = `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`.trim();
      return (
        /\b(--no-binary|PIP_NO_BINARY|--build-from-source|node-gyp\s+rebuild|npm\s+rebuild|prebuild-install\b.*\|\|\s*node-gyp)\b/i.test(
          text,
        ) ||
        /--no-optional\b|--omit=optional\b/i.test(text) ||
        /\b(apt(?:-get)?\s+install|apk\s+add|dnf\s+install|yum\s+install)\b.*\b(build-essential|gcc|g\+\+|make|python3?-dev|libxml2-dev|libxslt-dev|cairo|pango|libvips|rust|cargo|musl-dev)\b/i.test(
          text,
        )
      );
    }),
  );
}

function sourceBuildSmellSummary(workflow: WorkflowDocument): string[] {
  const labels = new Set<string>();

  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const text = `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""}`.trim();
      if (/\b(--no-binary|PIP_NO_BINARY)\b/i.test(text)) {
        labels.add("pip no-binary path");
      }
      if (
        /\b(--build-from-source|node-gyp\s+rebuild|npm\s+rebuild|prebuild-install\b.*\|\|\s*node-gyp)\b/i.test(
          text,
        )
      ) {
        labels.add("explicit native build path");
      }
      if (/--no-optional\b|--omit=optional\b/i.test(text)) {
        labels.add("optional dependency bypass");
      }
      if (
        /\b(apt(?:-get)?\s+install|apk\s+add|dnf\s+install|yum\s+install)\b.*\b(build-essential|gcc|g\+\+|make|python3?-dev|libxml2-dev|libxslt-dev|cairo|pango|libvips|rust|cargo|musl-dev)\b/i.test(
          text,
        )
      ) {
        labels.add("native build toolchain install");
      }
    }
  }

  return [...labels].sort();
}

export const nativeDependencyMayFallBackToSourceBuildRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const nodePackages = context.repository.nativePackages.node;
    const pythonPackages = context.repository.nativePackages.python;
    if (
      (nodePackages.length === 0 && pythonPackages.length === 0) ||
      !workflowHasSourceBuildSmell(workflow) ||
      (context.repository.primaryWorkflowPath !== undefined &&
        workflow.relativePath !== context.repository.primaryWorkflowPath)
    ) {
      return [];
    }

    const smellSummary = sourceBuildSmellSummary(workflow);
    const packageSummary = [
      nodePackages.length > 0 ? `Node: ${nodePackages.join(", ")}` : undefined,
      pythonPackages.length > 0 ? `Python: ${pythonPackages.join(", ")}` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join("; ");

    return [
      buildDiagnostic(workflow, meta, workflow.root, {
        message:
          "Repository uses native-heavy packages and the workflow also shows install conditions that may bypass wheels or prebuilt binaries.",
        why: `Visible native-heavy packages (${packageSummary}) overlap with workflow-level source-build smells (${smellSummary.join(", ")}). That can mean unexpected fallbacks to source builds instead of using a wheel or prebuilt binary.`,
        suggestion:
          "Check install logs for wheel or prebuilt usage before changing anything. If this path is falling back to source builds by accident, simplify the install flags, reduce unnecessary build toolchain setup, or use a more compatible base environment.",
        measurementHint:
          "Compare total install time and inspect logs for signs such as `building wheel`, `node-gyp`, or other native build output before and after any change.",
        aiHandoff:
          "Review package-manager logs and workflow setup together, confirm whether native-heavy dependencies are unexpectedly falling back to source builds, and only simplify flags, toolchain setup, or base environment after verifying the actual install path.",
        score: 30 + Math.min(8, smellSummary.length + nodePackages.length + pythonPackages.length),
      }),
    ];
  },
};
