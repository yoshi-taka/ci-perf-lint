import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-test-reporter-2-3-for-xml",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-test-reporter-2-3-for-xml.md",
} satisfies RuleMeta;

const xmlReporters = new Set([
  "dotnet-nunit",
  "dotnet-trx",
  "java-junit",
  "jest-junit",
  "python-xunit",
  "swift-xunit",
]);

export const preferTestReporter23ForXmlRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter(
        (step) =>
          cacheActionVersionIsBelow(step, "dorny/test-reporter", [2, 3, 0]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false" &&
          typeof step.with?.reporter === "string" &&
          xmlReporters.has(step.with.reporter.trim()),
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" parses XML using test-reporter before v2.3.0: ${offenders.map((step) => `${step.uses} (${String(step.with?.reporter)})`).join(", ")}.`,
          why: "test-reporter v2.3.0 updates sax.js to fix expensive parsing of huge XML CDATA sections. The upstream example used about 5 GiB of memory and several seconds to parse a 50 MB log before the fix. XML reporter selection is visible, but report size is not; small reports may see little benefit. This does not speed up test execution.",
          suggestion:
            "Upgrade dorny/test-reporter to v2.3.0 or a later compatible release while preserving reporter format, paths, artifact selection, permissions and failure policy. Check compatibility when crossing Action major versions.",
          measurementHint:
            "Compare reporting-step duration and peak memory with the same XML files, especially reports containing large embedded logs. Confirm check results, annotations and failure behavior remain equivalent.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade old XML test-reporter pins to v2.3.0 or later. Preserve report inputs, permissions and failure behavior, and measure parsing time and memory using representative XML logs.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
