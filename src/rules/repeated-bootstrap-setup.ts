import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import {
  buildJobBootstrapProfile,
  jobBootstrapFingerprint,
} from "./shared/job-bootstrap-fingerprint.ts";

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
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const groups = new Map<string, BootstrapGroup>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const profile = buildJobBootstrapProfile(job);

      if (!profile.hasCheckout && !profile.hasInstall) {
        continue;
      }

      const bootstrapFp = bootstrapFingerprint(profile);

      const group = groups.get(bootstrapFp) ?? {
        bootstrapFp,
        jobs: [],
        hasLint: false,
        hasTest: false,
        hasBuild: false,
      };
      group.jobs.push(job.id);

      const fullFp = jobBootstrapFingerprint(profile);
      if (fullFp.includes("L")) {
        group.hasLint = true;
      }
      if (fullFp.includes("T")) {
        group.hasTest = true;
      }
      if (fullFp.includes("B")) {
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
        message: `${totalJobs} jobs share the same bootstrap fingerprint "${group.bootstrapFp}": ${sortedJobIds.join(", ")}${stepDesc}.`,
        why: "Each job repeats checkout, dependency installation, and cache restore independently. When jobs share the same bootstrap pattern, the setup cost is multiplied without adding proportional value.",
        suggestion:
          "Consider running all work types in one job with parallel steps, or consolidating the bootstrap setup by passing a dependency artifact between jobs.",
        measurementHint:
          "Compare total workflow duration and runner minutes after consolidating the repeated bootstrap setup across one pair of jobs.",
        aiHandoff: `Review ${workflow.relativePath} jobs ${sortedJobIds.join(", ")} for shared bootstrap setup (fingerprint "${group.bootstrapFp}") and consolidate if the jobs can share an artifact.`,
        score: 56,
      });
    });
  },
};

function bootstrapFingerprint(profile: ReturnType<typeof buildJobBootstrapProfile>): string {
  const parts: string[] = [
    profile.hasCheckout ? "C" : "_",
    profile.hasInstall ? `I${profile.installManager ?? "?"}` : "_",
    profile.hasCache ? "K" : "_",
  ];
  return parts.join("");
}
