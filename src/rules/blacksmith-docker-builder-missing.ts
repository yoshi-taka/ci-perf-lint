import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { blacksmithDockerBuilds } from "./shared/blacksmith-docker.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "blacksmith-docker-builder-missing",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/blacksmith-docker-builder-missing.md",
} satisfies RuleMeta;

export const blacksmithDockerBuilderMissingRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return blacksmithDockerBuilds(workflow)
      .filter(({ missing }) => missing)
      .map(({ jobId, step }) =>
        buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
          message: `Job "${jobId}" uses useblacksmith/build-push-action@v2 without visible Docker builder setup.`,
          why: "The build action alone does not enable Blacksmith's persistent Docker layer cache; it uses the environment's default builder.",
          suggestion:
            "If persistent layer caching is intended, configure useblacksmith/setup-docker-builder@v2 before the build with a stable cache-key for this workload. Review storage charges ($0.50/GB/month), cache branch protection and trusted/untrusted job boundaries; retain any intentional alternative cache.",
          measurementHint:
            "Compare warm-run build time, cache hits, and storage cost against the existing builder; the first run populates the cache.",
          aiHandoff: `Review job "${jobId}" in ${workflow.relativePath}. Confirm persistent Blacksmith caching is intended before adding setup-docker-builder@v2 and a workload-specific cache-key. Preserve publishing and existing cache consumers; review added storage cost.`,
          score: 45,
        }),
      );
  },
};
