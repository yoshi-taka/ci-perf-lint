import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-setup-java-v6",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-java-v6.md",
} satisfies RuleMeta;

export const preferSetupJavaV6Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter(
        (step) =>
          cacheActionVersionIsBelow(step, "actions/setup-java", [6, 0, 0]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false",
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" uses setup-java before the v6 setup-performance milestone: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "setup-java v6 adds parallel dependency/wrapper cache restoration, a lazy-loaded Temurin tool-cache fast path, cheaper warm Maven configuration, moving extracted JDKs instead of copying them, and resolved-JDK caching that can avoid vendor API calls on warm jobs. The gains depend on distribution, cache state, and inputs; they are not merely a Node runtime or ESM version bump.",
          suggestion:
            "Upgrade actions/setup-java to v6 or a later compatible release while preserving java-version, distribution, architecture, package type, cache configuration, and Maven/GPG settings. Check Node 24 runner support; migrate removed Adopt/Adopt OpenJ9 distributions to supported alternatives if used. Measure cold and warm setup time rather than assuming a fixed speedup.",
          measurementHint:
            "Compare setup-java duration, JDK download/configuration time, and dependency/wrapper cache restore time on cold and warm runs. Verify the selected Java version, Maven toolchains, credentials, and signing behavior.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade its old setup-java refs to v6 or later. Preserve the JDK version/distribution matrix and cache inputs, review Maven credentials/toolchains/GPG compatibility and runner support, then compare cold and warm setup timings.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
