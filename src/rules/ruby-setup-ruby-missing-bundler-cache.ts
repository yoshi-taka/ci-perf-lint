import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isManualCacheStep, jobAllowsActionsCacheRestore } from "./shared/workflow-caches.ts";
import { textRunsBundlerInstall } from "./shared/bundler-commands.ts";

const meta = {
  id: "ruby-setup-ruby-missing-bundler-cache",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/ruby-setup-ruby-missing-bundler-cache.md",
} satisfies RuleMeta;

const rubySetupUsesPattern = /^ruby\/setup-ruby(?:@|$)/i;

const noCacheNamePattern = /\b(?:no\s+cache|disable\s+cache)\b/i;

function setupStepNeedsBundlerCache(step: WorkflowStep): boolean {
  const val = step.with?.["bundler-cache"];
  const normalized = typeof val === "string" ? val.trim().toLowerCase() : val;
  return (
    normalized === undefined || normalized === false || normalized === "false" || normalized === ""
  );
}

function hasNoCacheCommentInName(step: WorkflowStep): boolean {
  const name = step.name ?? "";
  return noCacheNamePattern.test(name);
}

function findUncachedBundlerSetup(job: WorkflowJob): WorkflowStep | undefined {
  let setupStep: WorkflowStep | undefined;
  for (const step of job.steps) {
    if (step.uses && rubySetupUsesPattern.test(step.uses)) {
      setupStep = step;
    } else if (
      setupStep &&
      setupStepNeedsBundlerCache(setupStep) &&
      !hasNoCacheCommentInName(step) &&
      textRunsBundlerInstall(step.run ?? "")
    ) {
      return setupStep;
    }
  }
  return undefined;
}

function jobRunsInsideContainer(job: WorkflowJob): boolean {
  return Boolean(job.raw.container);
}

function jobHasCustomBundlerCache(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    if (!isManualCacheStep(step) || step.uses?.toLowerCase().startsWith("actions/cache/save@")) {
      return false;
    }
    const paths = step.with?.path;
    const values = typeof paths === "string" ? [paths] : Array.isArray(paths) ? paths : [];
    return values.some(
      (value) =>
        typeof value === "string" && /\b(?:vendor\/bundle|\.bundle|rubygems|gems)\b/i.test(value),
    );
  });
}

export const rubySetupRubyMissingBundlerCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || !jobAllowsActionsCacheRestore(workflow, job)) {
        continue;
      }

      const setupStep = findUncachedBundlerSetup(job);
      if (!setupStep) {
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
            "Consider adding `bundler-cache: true` to the matching `ruby/setup-ruby` step after aligning its Gemfile, environment and working directory with the manual install. Remove only redundant install commands; preserve bundle check, bundle exec and other surrounding work.",
          measurementHint:
            "Compare total job duration before and after enabling `bundler-cache: true`.",
          aiHandoff: `In ${workflow.relativePath} job "${job.id}", align the matching Ruby setup action's Gemfile, environment and working directory with the manual Bundler install, then consider bundler-cache: true. Preserve preceding bundle configuration and surrounding checks/tests; remove only redundant install invocations after verifying equivalent behavior.`,
          score: 70,
        }),
      );
    }

    return findings;
  },
};
