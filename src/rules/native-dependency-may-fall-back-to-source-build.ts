import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dependencyInstallCommands } from "./shared/dependency-install-evidence.ts";
import { toolInvocations } from "./shared/tool-command-evidence.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import { githubEnvironmentValues } from "./shared/shell-environment-evidence.ts";

const meta = {
  id: "native-dependency-may-fall-back-to-source-build",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/native-dependency-may-fall-back-to-source-build.md",
} satisfies RuleMeta;

function sourceBuildSmellSummary(workflow: WorkflowDocument): string[] {
  const labels = new Set<string>();

  for (const job of workflow.jobs) {
    const persisted: Record<string, string> = {};
    for (const step of job.steps) {
      const run = step.run ?? "";
      if (
        toolInvocations(run).some(
          ([tool, action]) => ["node-gyp", "npm"].includes(tool ?? "") && action === "rebuild",
        )
      ) {
        labels.add("explicit native build path");
      }
      for (const command of dependencyInstallCommands(run, {
        ...persisted,
        ...effectiveStepEnvironment(workflow, job, step),
      })) {
        if (
          command.options.some(({ name, value }) => name === "--no-binary" && value !== ":none:") ||
          (typeof command.environment.PIP_NO_BINARY === "string" &&
            !/[$`]|__shell_substitution__/.test(command.environment.PIP_NO_BINARY) &&
            command.environment.PIP_NO_BINARY !== ":none:" &&
            command.environment.PIP_NO_BINARY !== "")
        ) {
          labels.add("pip no-binary path");
        }
        if (
          command.options.some(
            ({ name, value }) => name === "--build-from-source" && value !== "false",
          )
        ) {
          labels.add("explicit native build path");
        }
        if (
          command.options.some(
            ({ name, value }) =>
              (name === "--no-optional" && value !== "false") ||
              (name === "--omit" && value?.split(",").includes("optional")),
          )
        ) {
          labels.add("optional dependency bypass");
        }
        if (
          ["apt", "apt-get", "apk", "dnf", "yum"].includes(command.tool) &&
          command.packages.some((pkg) =>
            /^(?:build-essential|gcc|g\+\+|make|python3?-dev|libxml2-dev|libxslt-dev|cairo|pango|libvips|rust|cargo|musl-dev)(?:$|[=@])/.test(
              pkg,
            ),
          )
        ) {
          labels.add("native build toolchain install");
        }
      }
      Object.assign(persisted, githubEnvironmentValues(run));
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
      (context.repository.primaryWorkflowPath !== undefined &&
        workflow.relativePath !== context.repository.primaryWorkflowPath)
    ) {
      return [];
    }

    const smellSummary = sourceBuildSmellSummary(workflow);
    if (smellSummary.length === 0) {
      return [];
    }
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
