import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { blacksmithDockerBuilds } from "./shared/blacksmith-docker.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "blacksmith-docker-cache-export",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/blacksmith-docker-cache-export.md",
} satisfies RuleMeta;

export const blacksmithDockerCacheExportRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return blacksmithDockerBuilds(workflow)
      .filter(({ persistent, step }) => {
        const cacheTo = step.with?.["cache-to"];
        return (
          persistent &&
          typeof cacheTo === "string" &&
          /(?:^|[\n,])\s*type=(?:gha|registry|inline)(?:[,\s]|$)/.test(cacheTo)
        );
      })
      .map(({ jobId, step }) =>
        buildDiagnostic(workflow, meta, step.withNode ?? step.node, {
          message: `Job "${jobId}" exports Docker cache despite configuring a persistent Blacksmith builder.`,
          why: "Blacksmith persists builder layers and cache mounts on disk. Extra exports add cache preparation and, depending on the backend, transfer work. Inline exports primarily add metadata and may have little cost.",
          suggestion:
            "Review cache-to and remove the extra export only if no other runner or workflow consumes it. Keep exports needed for external builders or fallback caching; do not remove cache-from without checking its consumers and purpose.",
          measurementHint:
            "Compare cache export duration and total warm-build time; verify other builders still reuse their cache and image publication is unchanged.",
          aiHandoff: `Review cache-to in job "${jobId}" of ${workflow.relativePath}. Trace external cache consumers and Blacksmith fallback requirements before removing any export. Preserve cache-from, image tags, push settings, and required downstream builds unless separately verified.`,
          score: 42,
        }),
      );
  },
};
