import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-rails-performance-milestone",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-rails-performance-milestone.md",
} satisfies RuleMeta;

const railsCIPattern = /\b(?:rspec|rails\s+test|rake\s+test|assets:precompile)\b/i;

function jobRunsRailsCI(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const text = `${step.name ?? ""} ${step.run ?? ""}`;
    return railsCIPattern.test(text);
  });
}

export const preferRailsPerformanceMilestoneRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { usesRails, railsVersionSpec, railsMajor, railsMinor, rubyMajor } =
      context.repository.frameworks;

    if (!usesRails || !railsVersionSpec || railsMajor === undefined || railsMinor === undefined) {
      return [];
    }

    if (railsMajor < 7 || (railsMajor === 7 && railsMinor >= 2)) {
      return [];
    }

    if (rubyMajor !== undefined && rubyMajor < 3) {
      return [];
    }

    return workflow.jobs
      .filter((job) => !job.usesReusableWorkflow && jobRunsRailsCI(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Rails CI while the repository is on Rails ${railsVersionSpec}, below the 7.2 performance milestone.`,
          why: "Rails 7.2 enables YJIT by default in development and test environments, and with Ruby 3.3+ YJIT test suites can run noticeably faster without rewriting application code. Note that the benefit depends on the suite: Rails 8.1 changed this default to enable YJIT only outside local environments, because development and test reload code and redefine methods (for example with mocking), where YJIT is not generally faster.",
          suggestion:
            "If a major-version upgrade is not feasible yet, upgrade Rails from the current version to at least 7.2.x and ensure `config.yjit = true` is present (default since 7.2).",
          measurementHint:
            "Compare test suite wall-clock time with YJIT on (Rails 7.2, Ruby 3.3+) vs YJIT off (Rails 7.0/7.1).",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the repository Rails version. If compatibility allows, upgrade Rails from ${railsVersionSpec} to at least 7.2.x. Rails 7.2 enables YJIT by default on Ruby 3.3+, which is the single largest CI performance improvement available to Rails applications.`,
          score: 55,
        }),
      );
  },
};
