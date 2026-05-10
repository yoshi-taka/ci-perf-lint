import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isManualCacheStep } from "./shared/workflow-caches.ts";

const meta = {
  id: "ruby-setup-ruby-missing-bundler-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/ruby-setup-ruby-missing-bundler-cache.md",
} satisfies RuleMeta;

const rubySetupUsesPattern = /^ruby\/setup-ruby(?:@|$)/i;

const bundleInstallPattern = /\bbundle\s+install\b/i;

const bundleNotInstallPattern = /\bbundle\s+(?:check|exec|outdated|audit)\b/i;

const bundleNoCacheFlagPattern = /\bbundle\s+install\s+--no-cache\b/i;

const noCacheNamePattern = /\b(?:no\s+cache|disable\s+cache)\b/i;

function findRubySetupStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) => step.uses && rubySetupUsesPattern.test(step.uses));
}

function setupStepHasBundlerCache(step: WorkflowStep): boolean {
  const val = step.with?.["bundler-cache"];
  return val === true || val === "true";
}

function hasNoCacheCommentInName(step: WorkflowStep): boolean {
  const name = step.name ?? "";
  return noCacheNamePattern.test(name);
}

function findBundlerInstallStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) => {
    const run = step.run ?? "";
    if (!run) {
      return false;
    }
    if (bundleNotInstallPattern.test(run)) {
      return false;
    }
    if (bundleNoCacheFlagPattern.test(run)) {
      return false;
    }
    return bundleInstallPattern.test(run);
  });
}

function jobRunsInsideContainer(job: WorkflowJob): boolean {
  return Boolean(job.raw.container);
}

function jobHasCustomBundlerCache(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    if (!isManualCacheStep(step)) {
      return false;
    }
    const path = step.with?.path;
    if (typeof path !== "string") {
      return false;
    }
    return /\b(?:vendor\/bundle|\.bundle|rubygems|gems)\b/i.test(path);
  });
}

export const rubySetupRubyMissingBundlerCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const setupStep = findRubySetupStep(job);
      if (!setupStep) {
        continue;
      }

      if (setupStepHasBundlerCache(setupStep)) {
        continue;
      }

      const installStep = findBundlerInstallStep(job);
      if (!installStep) {
        continue;
      }

      if (hasNoCacheCommentInName(installStep)) {
        continue;
      }

      if (jobRunsInsideContainer(job)) {
        continue;
      }

      if (jobHasCustomBundlerCache(job)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, setupStep.usesNode ?? setupStep.node, {
          message: `Job "${job.id}" uses \`ruby/setup-ruby\` and runs \`bundle install\` manually, but does not enable \`bundler-cache: true\`.`,
          why: "ruby/setup-ruby supports built-in Bundler caching via `bundler-cache: true`. When enabled, it runs `bundle install` and caches installed gems automatically, reducing dependency install time on repeated CI runs.",
          suggestion:
            "Replace the manual `bundle install` step by adding `bundler-cache: true` to the `ruby/setup-ruby` step.",
          measurementHint:
            "Compare total job duration before and after enabling `bundler-cache: true`.",
          aiHandoff: `In ${workflow.relativePath} job "${job.id}", \`ruby/setup-ruby\` is used without \`bundler-cache: true\` but a manual \`bundle install\` step exists. If this job repeats dependency installs on every run, adding \`bundler-cache: true\` to the \`ruby/setup-ruby\` step can save time by caching installed gems.`,
          score: 70,
        }),
      );
    }

    return findings;
  },
};
