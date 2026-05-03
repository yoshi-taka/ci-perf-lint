import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const DD_EXTENSION_USES = /^datadog\/datadog-lambda-extension@v(\d+)(?:\.\d+)*$/i;
const MINIMUM_MAJOR = 88;

const meta = {
  id: "outdated-datadog-lambda-extension",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/outdated-datadog-lambda-extension.md",
} satisfies RuleMeta;

export const outdatedDatadogLambdaExtensionRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        if (!step.uses) {
          continue;
        }

        const match = step.uses.match(DD_EXTENSION_USES);
        if (!match) {
          continue;
        }

        const version = parseInt(match[1] ?? "0", 10);
        if (version >= MINIMUM_MAJOR) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.usesNode ?? step.node, {
            message: `Datadog Lambda Extension v${version} is on the old Go-based compatibility track. v${MINIMUM_MAJOR} and later ship only the Rust-based Next Generation Extension.`,
            why: "v87 was the last release to bundle the legacy Go Agent for compatibility mode. Starting with v88, the extension contains only the Rust-based Next Generation Extension (Bottlecap), which reduces cold-start latency and memory overhead. The extension layer size drops by roughly 50% compared to earlier versions.",
            suggestion: `Upgrade to v${MINIMUM_MAJOR} or later by updating the workflow reference (for example, \`uses: datadog/datadog-lambda-extension@v${MINIMUM_MAJOR}\`). If you reference the Lambda Layer ARN directly, change the layer version to ${MINIMUM_MAJOR} or higher.`,
            measurementHint:
              "After upgrading, verify the extension version in the Datadog Web UI (Serverless View or Lambda function details).",
            aiHandoff: `Review ${workflow.relativePath} and update \`${step.uses}\` to target \`datadog/datadog-lambda-extension@v${MINIMUM_MAJOR}\` or higher. If the version is set via a Lambda Layer ARN, bump the layer version to ${MINIMUM_MAJOR}+.`,
            score: 80,
          }),
        );
      }
    }

    return findings;
  },
};
