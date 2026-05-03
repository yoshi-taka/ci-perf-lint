import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import {
  hasHistoryDependentCommand,
  hasOpaqueRepoScriptExecution,
  jobPublishesScorecardResults,
} from "./shared/workflow-jobs.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "unnecessary-checkout-when-only-using-artifacts",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/unnecessary-checkout-when-only-using-artifacts.md",
} satisfies RuleMeta;

const ARTIFACT_ACTIONS = ["actions/download-artifact@", "actions/upload-artifact@"];

const KNOWN_HISTORY_REQUIRING_ACTIONS = [
  "e18e/action-dependency-diff@",
  "chromaui/action@",
  "lunariajs/action@",
  "goreleaser/goreleaser-action@",
  "peter-evans/create-pull-request@",
];

function jobUsesArtifactAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    return ARTIFACT_ACTIONS.some((a) => uses.startsWith(a));
  });
}

function jobUsesKnownHistoryRequiringAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    return KNOWN_HISTORY_REQUIRING_ACTIONS.some((a) => uses.startsWith(a));
  });
}

function jobUsesLocalAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses ?? "";
    return uses.startsWith("./");
  });
}

function jobRunsMake(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const run = step.run ?? "";
    return /\bmake\b/.test(run);
  });
}

function jobRunsGitApply(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const run = step.run ?? "";
    return /\bgit\s+apply\b/i.test(run);
  });
}

function jobHasHeavyBuildOrInstall(job: WorkflowJob): boolean {
  const heavyPattern =
    /(npm\s+(ci|install)|pnpm\s+(install|add)|yarn\s+install|bun\s+install|pip\s+install|poetry\s+install|\buv\s+sync|cargo\s+build|go\s+(build|test)|make\s+build|\bbuild\b)/i;
  return job.steps.some((step) => {
    const text = `${step.name ?? ""} ${step.run ?? ""}`;
    return heavyPattern.test(text);
  });
}

function jobHasRepoFileOperations(job: WorkflowJob): boolean {
  const repoFilePattern =
    /\b(?:rm|cp|mv|cat|chmod|chown|ln|rsync|tar)\s+(?:-[a-zA-Z]+\s+)*(?:\.\/)?[a-zA-Z_][a-zA-Z0-9_@./-]*\/[a-zA-Z0-9_@./{}*?!=-]+/;
  return job.steps.some((step) => {
    const run = step.run ?? "";
    return repoFilePattern.test(run);
  });
}

function jobLooksLikeArtifactOnly(job: WorkflowJob): boolean {
  return (
    jobUsesArtifactAction(job) &&
    !jobUsesLocalAction(job) &&
    !jobUsesKnownHistoryRequiringAction(job) &&
    !jobPublishesScorecardResults(job) &&
    !jobHasHeavyBuildOrInstall(job) &&
    !jobRunsMake(job) &&
    !jobRunsGitApply(job) &&
    !hasHistoryDependentCommand(job) &&
    !hasOpaqueRepoScriptExecution(job) &&
    !jobHasRepoFileOperations(job)
  );
}

export const unnecessaryCheckoutWhenOnlyUsingArtifactsRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      const checkoutStep = job.steps.find(
        (step) =>
          typeof step.uses === "string" && step.uses.toLowerCase().startsWith("actions/checkout@"),
      );

      if (!checkoutStep) {
        continue;
      }

      if (!jobLooksLikeArtifactOnly(job)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, checkoutStep.usesNode ?? checkoutStep.node, {
          message: `actions/checkout in job "${job.id}" may be unnecessary when only using artifact actions.`,
          why: "This job uses download-artifact or upload-artifact but shows no visible dependency on repository files (no local actions, no build/install commands, no history-dependent git operations, no repository scripts). When a job only consumes or produces artifacts, repository checkout adds unnecessary clone time.",
          suggestion:
            "Remove the actions/checkout step if the job truly only needs artifact data. Verify that no run commands reference repository files, and that no downstream steps depend on the working tree.",
          measurementHint: "Compare job duration before and after removing the checkout step.",
          aiHandoff: `Inspect ${workflow.relativePath} job "${job.id}" and remove actions/checkout if only artifact actions are needed. Preserve unrelated behavior.`,
          score: 60,
        }),
      );
    }

    return findings;
  },
};
