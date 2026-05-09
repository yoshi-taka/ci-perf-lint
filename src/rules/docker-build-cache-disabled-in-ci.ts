import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";
import { textDisablesDockerBuildCache } from "./shared/docker.ts";

const meta = {
  id: "docker-build-cache-disabled-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/docker-build-cache-disabled-in-ci.md",
  scope: "all",
} satisfies RuleMeta;

export const dockerBuildCacheDisabledInCiRule = {
  meta,
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ) {
    const entries = collectCommandEntries(workflow);
    const entry = entries.find((e) => textDisablesDockerBuildCache(e.text));
    if (!entry) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, entry.node, {
        message: `Job "${entry.jobName}" disables Docker build cache in CI.`,
        why: "Docker cache reuse is the main way repeated image builds avoid re-running unchanged COPY and RUN work. A routine `--no-cache` or build action `no-cache: true` makes every CI run rebuild all layers.",
        suggestion:
          "Remove routine Docker no-cache settings from CI. Use targeted cache busting, `--no-cache-filter`, or a manual/debug workflow when a fresh rebuild is intentionally needed.",
        measurementHint:
          "Compare Docker build wall-clock time and cache-hit output before and after removing routine no-cache usage.",
        aiHandoff: `Review job "${entry.jobName}" in ${workflow.relativePath} and remove routine Docker no-cache usage from CI. Keep full no-cache rebuilds only for explicit debug or refresh paths.`,
        score: 80,
      }),
    ];
  },
};
