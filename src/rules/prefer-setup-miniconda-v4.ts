import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-setup-miniconda-v4",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-miniconda-v4.md",
} satisfies RuleMeta;

export const preferSetupMinicondaV4Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter(
        (step) =>
          cacheActionVersionIsBelow(step, "conda-incubator/setup-miniconda", [4, 0, 0]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false",
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" uses setup-miniconda before the v4 setup-performance milestone: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "setup-miniconda v4 removes HTML index scraping for Miniconda version validation, replaces environment/configuration subprocesses with local YAML reads and direct .condarc writes, and avoids duplicate channel configuration. On Windows it also parallelizes takeown calls and speeds post-run cleanup by moving extracted package directories instead of deleting files individually. Benefits depend on the installation path and inputs; this is not merely a Node runtime or ESM version bump.",
          suggestion:
            "Upgrade conda-incubator/setup-miniconda to v4 or a later compatible release. Preserve Python/Conda/Miniforge versions, installer URLs, environment files, channels, solver and mamba settings, activation inputs, and shell initialization. Verify Node 24 runner support and measure setup plus post-cleanup time without changing the dependency environment.",
          measurementHint:
            "Compare setup-miniconda and post-cleanup duration with the same environment and cache state on cold and warm runs. Verify package versions, channel order, activated environment and login-shell behavior still match.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade its old setup-miniconda refs to v4 or later. Preserve environment/installer/version pins, channels and solver settings, activation and login-shell configuration, and run-post policy. Check runner support and compare setup/post-cleanup timings.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
