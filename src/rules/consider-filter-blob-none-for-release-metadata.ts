import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { withRepositoryBlobNoneReleasePrecedent } from "./shared/similar-workflow-consensus.ts";
import { getLoweredWorkflowStepText } from "./shared/workflow-step-text.ts";
import { hasHistoryDependentCommand } from "./shared/workflow-jobs.ts";
import { collectScopePrefixes } from "./shared/workflow-path-prefixes.ts";
import { getCheckoutStep } from "./shared/workflow-analysis.ts";

const wideRepoAccessPattern =
  /(find\s+\.\b|rg\s+(?:--files\b|\.)|fd\s+\.\b|git\s+grep\b|ls\s+-r\b|du\s+-|turbo\s+run\b|nx\s+affected\b|lerna\b)/;
const heavyBuildOrInstallPattern =
  /(\bnpm\b\s+(?:\S+\s+)*?(?:ci\b|install\b|run\s+build\b)|\b(?:pnpm|yarn)\b\s+(?:\S+\s+)*?(?:install\b|build\b)|\bbun\b\s+(?:\S+\s+)*?(?:install\b|run\s+build\b)|\bpytest\b|\bjest\b|\bvitest\b|\bcargo\s+(?:build|check|clippy|test|bench|doc|package|publish|install|b|c|t|ck|br|cl|rr)\b|\bgradle\b|\bmvn\b|tauri|electron-builder|docker build)/;
const blobHungryReleasePattern =
  /(install-code-deps["']?\s*:\s*(?:["']?true|true)|\brelease:publish\b|changeset\s+version\b|\b(?:npm|pnpm|yarn|bun)\b\s+(?:\S+\s+)*?(?:run\s+)?(?:build\b|compile\b|pack\b|publish\b)|\byarn\s+task\b[\s\S]*\bcompile\b)/;
const gitCheckoutPublishBuildPattern = /\bgit\s+(?:checkout|pull|merge)\b/;
const publishCompileBuildPattern = /\b(?:publish|compile|build)\b/;
const agenticToolPattern =
  /(sst\/opencode\/github@|claude|codex|openai|anthropic|gemini|ai agent|agentic|autofix|code review)/;
const docsPattern =
  /(content\/docs|docs\/|documentation|update docs|write docs|edit docs|changed files|modified files)/;
const gitFetchDepthPattern = /\bgit\s+fetch\b(?=[\s\S]*--depth[=\s]\d+)/;
const releaseNotesChangelogTagPattern =
  /\b(release notes|changelog|tag|version|release|commitlint)\b/;
const releaseNotesChangelogTagJobPattern =
  /\b(release-notes|release_notes|changelog|tag|version|release|commitlint)\b/;
const historyMetadataPattern =
  /(\bgh\s+release\s+(?:create|view|edit|upload)\b|\bgh\s+api\b.*\/releases\b|\bgit\s+(?:describe|tag|rev-list|log)\b|commitlint|commitlint-github-action|release notes|changelog|previous tag|semantic-release|release-it|changeset|git-cliff|conventional-changelog|changelogithub|release-please|googleapis\/release-please-action@|release-please-automation-action@|softprops\/action-gh-release@|ncipollo\/release-action@|release-drafter\/release-drafter@|actions\/create-release@|e18e\/action-dependency-diff@)/;
const strongReleaseMetadataPattern =
  /(\bgh\s+release\s+(?:create|view|edit|upload)\b|\bgh\s+api\b.*\/releases\b|\bgit\s+(?:describe|tag|rev-list|log)\b|previous tag|release notes|changelog|git-cliff|conventional-changelog|changelogithub|release-please|googleapis\/release-please-action@|release-please-automation-action@|softprops\/action-gh-release@|ncipollo\/release-action@|release-drafter\/release-drafter@|actions\/create-release@|e18e\/action-dependency-diff@)/;
const commitlintPattern = /\bcommitlint\b/;
const commitlintActionPattern = /(commitlint|commitlint-github-action)/;

const meta = {
  id: "consider-filter-blob-none-for-release-metadata",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/consider-filter-blob-none-for-release-metadata.md",
} satisfies RuleMeta;

function getCheckoutInput(step: WorkflowStep | undefined, key: string): string | undefined {
  const value = step?.with?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasSparseCheckout(step: WorkflowStep | undefined): boolean {
  return Boolean(getCheckoutInput(step, "sparse-checkout"));
}

function hasBlobNoneFilter(step: WorkflowStep | undefined): boolean {
  return getCheckoutInput(step, "filter") === "blob:none";
}

function hasDeepHistory(step: WorkflowStep | undefined): boolean {
  const value = step?.with?.["fetch-depth"];
  if (value === 0 || value === "0") {
    return true;
  }
  if (typeof value === "number" && value > 1000) {
    return true;
  }
  if (typeof value === "string" && /^\d{4,}$/.test(value) && Number(value) > 1000) {
    return true;
  }
  return false;
}

function jobUsesLocalAction(job: WorkflowJob): boolean {
  return job.steps.some((step) => (step.uses ?? "").startsWith("./"));
}

function jobHasWideRepoAccess(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return wideRepoAccessPattern.test(text);
  });
}

function jobHasHeavyBuildOrInstall(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return heavyBuildOrInstallPattern.test(text);
  });
}

function jobLooksLikeBlobHungryReleasePipeline(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text =
      `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""} ${JSON.stringify(step.with ?? {})}`.toLowerCase();
    if (blobHungryReleasePattern.test(text)) {
      return true;
    }

    return gitCheckoutPublishBuildPattern.test(text) && publishCompileBuildPattern.test(text);
  });
}

function jobLooksLikeRepoEditingAgenticDocsJob(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text =
      `${step.name ?? ""} ${step.run ?? ""} ${step.uses ?? ""} ${JSON.stringify(step.with ?? {})}`.toLowerCase();
    return agenticToolPattern.test(text) && docsPattern.test(text);
  });
}

function jobHasExplicitFilteredFetchCandidate(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return gitFetchDepthPattern.test(text) && !text.includes("--filter=");
  });
}

function jobLooksHistoryMetadataLike(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  const workflowName = workflow.name?.toLowerCase() ?? "";
  const jobId = job.id.toLowerCase();

  if (releaseNotesChangelogTagPattern.test(workflowName)) {
    return true;
  }

  if (releaseNotesChangelogTagJobPattern.test(jobId)) {
    return true;
  }

  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return historyMetadataPattern.test(text);
  });
}

function jobHasStrongReleaseMetadataSignal(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return strongReleaseMetadataPattern.test(text);
  });
}

function jobLooksCommitMetadataLike(job: WorkflowJob): boolean {
  const jobId = job.id.toLowerCase();
  if (commitlintPattern.test(jobId)) {
    return true;
  }

  return job.steps.some((step) => {
    const text = getLoweredWorkflowStepText(step);
    return commitlintActionPattern.test(text);
  });
}

function evaluateJobForBlobNone(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  context: RuleContext,
): Diagnostic | undefined {
  if (!jobLooksHistoryMetadataLike(workflow, job)) {
    return undefined;
  }

  const checkout = getCheckoutStep(job);
  if (!checkout || hasBlobNoneFilter(checkout)) {
    return undefined;
  }

  if (!hasDeepHistory(checkout) && !hasHistoryDependentCommand(job)) {
    return undefined;
  }

  if (
    jobHasWideRepoAccess(job) ||
    jobHasHeavyBuildOrInstall(job) ||
    jobLooksLikeBlobHungryReleasePipeline(job) ||
    jobLooksLikeRepoEditingAgenticDocsJob(job) ||
    jobUsesLocalAction(job)
  ) {
    return undefined;
  }

  const scopePrefixes = collectScopePrefixes(job);
  const hasExplicitFilteredFetchCandidate = jobHasExplicitFilteredFetchCandidate(job);
  if (
    !jobLooksCommitMetadataLike(job) &&
    !jobHasStrongReleaseMetadataSignal(job) &&
    !hasExplicitFilteredFetchCandidate &&
    !hasSparseCheckout(checkout) &&
    (scopePrefixes.length === 0 || scopePrefixes.length > 3)
  ) {
    return undefined;
  }

  return withRepositoryBlobNoneReleasePrecedent(
    buildDiagnostic(workflow, meta, checkout.withNode ?? checkout.usesNode ?? checkout.node, {
      message: `Job "${job.id}" keeps enough git history for metadata work, but checkout still downloads file blobs eagerly.`,
      why: `fetch-depth controls how many commits and trees are fetched; blobs are the file contents attached to those commits. This job appears to focus on commit, tag, version, or release metadata${scopePrefixes.length > 0 ? ` while touching only ${scopePrefixes.map((prefix) => `"${prefix}"`).join(", ")}` : ""}, so \`filter: blob:none\` can keep the same history depth while avoiding most file-content transfer until a file is actually read.`,
      suggestion: hasExplicitFilteredFetchCandidate
        ? "If this job mostly needs commit history, tags, and release metadata rather than repository file contents, keep the same depth and test checkout with `filter: blob:none`; if the later explicit `git fetch --depth` is the main history transfer, test adding `--filter=blob:none` there too."
        : "If this job mostly needs commit history, tags, and release metadata rather than repository file contents, keep the same depth and test checkout with `filter: blob:none`.",
      measurementHint: hasExplicitFilteredFetchCandidate
        ? "Compare checkout duration, explicit git fetch duration, transferred data, lazy blob fetches, and total job time before and after adding blob filtering with the same fetch depth."
        : "Compare checkout duration, transferred data, lazy blob fetches, and total job time before and after adding `filter: blob:none` with the same fetch depth.",
      aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test whether checkout can use filter: blob:none while preserving its commit, tag, release-notes, or versioning behavior.`,
      score: hasSparseCheckout(checkout) ? 74 : 68,
    }),
    context,
    workflow.relativePath,
    job.id,
  );
}

export const considerFilterBlobNoneForReleaseMetadataRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      const finding = evaluateJobForBlobNone(workflow, job, _context);
      if (finding) {
        findings.push(finding);
      }
    }

    return findings;
  },
};
