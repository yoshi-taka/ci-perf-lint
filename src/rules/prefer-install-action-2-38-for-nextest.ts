import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-install-action-2-38-for-nextest",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-install-action-2-38-for-nextest.md",
} satisfies RuleMeta;

export const preferInstallAction238ForNextestRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter((step) => {
        const tools = step.with?.tool;
        return (
          cacheActionVersionIsBelow(step, "taiki-e/install-action", [2, 38, 0]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false" &&
          typeof tools === "string" &&
          !tools.includes("${{") &&
          tools.split(",").some((tool) => /^(?:cargo-)?nextest(?:@[^\s,]+)?$/.test(tool.trim()))
        );
      });
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" installs cargo-nextest using install-action before v2.38.0: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "install-action v2.38.0 adds a dedicated cargo-nextest manifest and no longer uses cargo-binstall for its normal installation path. The upstream change explicitly improves installation performance and robustness. This targets tool installation, not nextest test execution; fallback work can still depend on platform and requested tool version.",
          suggestion:
            "Upgrade taiki-e/install-action to v2.38.0 or a later compatible release, preserving tool versions, checksum verification and fallback policy. Verify that the requested cargo-nextest binary remains supported on the runner.",
          measurementHint:
            "Compare cargo-nextest installation duration on the same platform with the same tool pin and cache state. Confirm the installed version and run the existing nextest command unchanged.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade old install-action refs used for cargo-nextest to v2.38.0 or later. Preserve all requested tools, version pins, checksum and fallback settings, and measure installation time.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
