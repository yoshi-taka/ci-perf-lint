import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { WorkflowSemantics } from "./shared/workflow-semantics.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { buildWorkflowSemantics } from "./shared/workflow-semantics.ts";

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
      if (job.usesReusableWorkflow || job.hasIf) {
        continue;
      }

      const jobMeta = semantics.jobs.find((j) => j.id === job.id);
      if (!jobMeta || jobMeta.hasMatrix) {
        continue;
      }

      if (!jobMeta.hasCheckout && !jobMeta.hasInstall) {
        continue;
      }

      const bootstrapFp = `${jobMeta.hasCheckout ? "C" : "_"}${jobMeta.hasInstall ? `I${jobMeta.installManager ?? "?"}` : "_"}${jobMeta.hasCache ? "K" : "_"}`;

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
          "Consider running all work types in one job with parallel steps, or consolidating the bootstrap setup by passing a dependency artifact between jobs.",
        measurementHint:
          "Compare total workflow duration and runner minutes after consolidating the repeated bootstrap setup across one pair of jobs.",
        aiHandoff: `Review ${workflow.relativePath} jobs ${sortedJobIds.join(", ")} for shared bootstrap setup and consolidate if the jobs can share an artifact.`,
        score: 56,
      });
    });
  },
};
