import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { getRunsOnSpec } from "./shared/runs-on-facts.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-sccache-action-0-0-6",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-sccache-action-0-0-6.md",
} satisfies RuleMeta;

export const preferSccacheAction006Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      const runner = getRunsOnSpec(job);
      if (
        jobIsStaticallyDisabled(job) ||
        !runner.labels.includes("self-hosted") ||
        runner.usesContainer
      ) {
        continue;
      }
      const offenders = job.steps.filter(
        (step) =>
          cacheActionVersionIsBelow(step, "mozilla-actions/sccache-action", [0, 0, 6]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false",
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" uses sccache-action before v0.0.6 on a self-hosted runner: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "sccache-action v0.0.6 checks the local tool cache before downloading the sccache archive and checksum. Older releases download even when the requested binary is already cached. Persistent self-hosted runners can avoid this setup work; this does not change compilation-cache hit rates and needs a warm tool cache.",
          suggestion:
            "Upgrade mozilla-actions/sccache-action to v0.0.6 or a later compatible release, preserving the sccache version, token and backend configuration. Confirm the runner retains its tool cache between jobs.",
          measurementHint:
            "Compare warm sccache setup duration and archive/checksum downloads with the same sccache version and runner. Measure compilation-cache behavior separately.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and update old sccache-action pins to v0.0.6 or later. Preserve binary version and cache backend settings, confirm persistent tool-cache reuse, and measure warm setup time.`,
          score: 40,
        }),
      );
    }
    return findings;
  },
};
