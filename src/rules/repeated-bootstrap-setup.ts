import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import type { WorkflowSemantics } from "./shared/workflow-semantics.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { buildWorkflowSemantics } from "./shared/workflow-semantics.ts";
import { workflowWorkingDirectory } from "./shared/workflow-command-context.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import { detectInstallCommandFromText } from "./shared/tools.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

function bootstrapIdentity(workflow: WorkflowDocument, job: WorkflowJob): string {
  const setup = job.steps
    .filter(
      (step) =>
        /^(?:actions\/(?:checkout|setup-|cache)|pnpm\/action-setup|astral-sh\/setup-uv|gradle\/actions\/setup-gradle)/i.test(
          step.uses ?? "",
        ) ||
        Boolean(detectInstallCommandFromText(step.run ?? "")) ||
        /\b(?:corepack|npm\s+(?:i|install)\s+(?:-g|--global))\b/.test(step.run ?? ""),
    )
    .map((step) => ({
      uses: step.uses,
      with: step.with,
      run: step.run,
      cwd: workflowWorkingDirectory(workflow, job, step),
      env: effectiveStepEnvironment(workflow, job, step),
    }));
  return canonical({
    runner: job.raw["runs-on"],
    container: job.raw.container,
    services: job.raw.services,
    environment: job.raw.environment,
    setup,
  });
}

const meta = {
  id: "repeated-bootstrap-setup",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/repeated-bootstrap-setup.md",
  maxFindings: 3,
} satisfies RuleMeta;

interface BootstrapGroup {
  bootstrapFp: string;
  jobs: string[];
  hasLint: boolean;
  hasTest: boolean;
  hasBuild: boolean;
}

export const repeatedBootstrapSetupRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const semantics: WorkflowSemantics =
      context.workflowSemantics instanceof Map
        ? (context.workflowSemantics.get(workflow) ?? buildWorkflowSemantics(workflow))
        : (context.workflowSemantics ?? buildWorkflowSemantics(workflow));
    const groups = new Map<string, BootstrapGroup>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || job.hasIf || job.raw.needs) {
        continue;
      }

      const jobMeta = semantics.jobs.find((j) => j.id === job.id);
      if (!jobMeta || jobMeta.hasMatrix) {
        continue;
      }

      if (!jobMeta.hasInstall) {
        continue;
      }

      const bootstrapFp = bootstrapIdentity(workflow, job);

      const group = groups.get(bootstrapFp) ?? {
        bootstrapFp,
        jobs: [],
        hasLint: false,
        hasTest: false,
        hasBuild: false,
      };
      group.jobs.push(job.id);
      if (jobMeta.hasLint) {
        group.hasLint = true;
      }
      if (jobMeta.hasTest) {
        group.hasTest = true;
      }
      if (jobMeta.hasBuild) {
        group.hasBuild = true;
      }
      groups.set(bootstrapFp, group);
    }

    const repeatedGroups = [...groups.values()].filter((g) => g.jobs.length >= 2);

    if (repeatedGroups.length === 0) {
      return [];
    }

    return repeatedGroups.map((group) => {
      const sortedJobIds = [...group.jobs].sort();
      const totalJobs = sortedJobIds.length;

      const stepTypes: string[] = [];
      if (group.hasLint) {
        stepTypes.push("lint");
      }
      if (group.hasTest) {
        stepTypes.push("test");
      }
      if (group.hasBuild) {
        stepTypes.push("build");
      }

      const stepDesc =
        stepTypes.length > 0 ? ` — they run ${stepTypes.join(", ")} respectively` : "";

      return buildDiagnostic(workflow, meta, workflow.jobsNode, {
        message: `${totalJobs} jobs share the same bootstrap setup: ${sortedJobIds.join(", ")}${stepDesc}.`,
        why: "Each job repeats checkout, dependency installation, and cache restore independently. When jobs share the same bootstrap pattern, the setup cost is multiplied without adding proportional value.",
        suggestion:
          "Consider sharing a dependency artifact between jobs. If independent tasks can share the same execution environment and workspace, GitHub Actions `parallel` steps can also share one bootstrap setup, but compete for the same runner CPU and memory; keep separate jobs when resource isolation matters.",
        measurementHint:
          "Compare total workflow duration, runner minutes, and peak memory after consolidating one pair of jobs. Sharing setup can reduce runner time without reducing workflow duration.",
        aiHandoff: `Review ${workflow.relativePath} jobs ${sortedJobIds.join(", ")} for shared bootstrap setup. Consider a shared dependency artifact or native parallel steps if execution environments are compatible. Before combining jobs, check shared-file writes, CPU/memory contention, permissions, and required checks. Measure workflow duration and runner minutes before retaining the change.`,
        score: 56,
      });
    });
  },
};
