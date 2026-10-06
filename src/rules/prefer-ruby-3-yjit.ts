import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-ruby-3-yjit",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-ruby-3-yjit.md",
} satisfies RuleMeta;

const rubyStepPattern =
  /\b(?:ruby\/setup-ruby@|bundle\s+install|bundle\s+exec|rails|rake|rspec)\b/i;

export const preferRuby3YjitRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const { rubyVersionSpec, rubyMajor, rubyMinor } = context.repository.frameworks;

    if (!rubyVersionSpec || rubyMajor === undefined || rubyMinor === undefined) {
      return [];
    }

    if (rubyMajor > 3 || (rubyMajor === 3 && rubyMinor >= 3)) {
      return [];
    }

    if (rubyMajor < 3 || (rubyMajor === 3 && rubyMinor < 2)) {
      return [];
    }

    const hasRubyJob = workflow.jobs.some(
      (job) =>
        !job.usesReusableWorkflow &&
        job.steps.some((step) => {
          const text = `${step.uses ?? ""} ${step.name ?? ""} ${step.run ?? ""}`;
          return rubyStepPattern.test(text);
        }),
    );
    if (!hasRubyJob) {
      return [];
    }

    return workflow.jobs
      .filter(
        (job) =>
          !job.usesReusableWorkflow &&
          job.steps.some((step) => {
            const text = `${step.uses ?? ""} ${step.name ?? ""} ${step.run ?? ""}`;
            return rubyStepPattern.test(text);
          }),
      )
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs on Ruby ${rubyVersionSpec}, below the 3.4 YJIT milestone.`,
          why: "YJIT became production-ready in Ruby 3.2. Ruby 3.3's YJIT is roughly 13% faster than 3.2's, and Ruby 3.4 is another 5-7% faster with lower memory use. With YJIT enabled, Ruby code in CI typically runs 30-60% faster. YJIT is opt-in at the Ruby level (`--yjit` or `RUBY_YJIT_ENABLE=1`), but Rails 7.2+ enables it by default on Ruby 3.3+.",
          suggestion:
            "Upgrade Ruby from the current version to at least 3.4.x and enable YJIT (`--yjit` or `RUBY_YJIT_ENABLE=1`); Rails 7.2+ enables it automatically on Ruby 3.3+.",
          measurementHint:
            "Compare test suite wall-clock time on Ruby 3.2 vs 3.4 with YJIT enabled.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and the repository Ruby version. If compatibility allows, upgrade Ruby from ${rubyVersionSpec} to at least 3.4.x and enable YJIT for a significant CI performance improvement. If the app uses Rails 7.2+ on Ruby 3.3+, YJIT is already enabled by default.`,
          score: 60,
        }),
      );
  },
};
