import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-cache-apt-pkgs-action-1-3-1",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cache-apt-pkgs-action-1-3-1.md",
} satisfies RuleMeta;

export const preferCacheAptPkgsAction131Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter((step) => {
        const packages = step.with?.packages;
        return (
          cacheActionVersionIsBelow(step, "awalsh128/cache-apt-pkgs-action", [1, 3, 1]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false" &&
          typeof packages === "string" &&
          packages.trim() !== "" &&
          !packages.includes("${{")
        );
      });
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" pins cache-apt-pkgs-action below v1.3.1 with packages to resolve: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "cache-apt-pkgs-action v1.3.1 batches package-version lookups into one apt-cache call, reducing repeated lookup work. Releases before v1.1.0 also lack its apt-fast installation optimization. Savings depend on the package list and cache state; v1.3.1 also updates the apt index before resolving versions.",
          suggestion:
            "Upgrade awalsh128/cache-apt-pkgs-action to v1.3.1 or a later compatible release while preserving packages, cache version and installation options. Check package resolution after the apt-index update and retain any needed package installation scripts.",
          measurementHint:
            "Compare package-version lookup and total apt setup duration with the same packages, runner image and cache state. Verify installed package versions and required post-install behavior.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and update old cache-apt-pkgs-action pins to v1.3.1 or later. Preserve package/cache inputs and verify resolved packages, installation scripts and setup duration.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
