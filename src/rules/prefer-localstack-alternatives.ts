import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-localstack-alternatives",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-localstack-alternatives.md",
} satisfies RuleMeta;

export const preferLocalstackAlternativesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const services = getNode(job.node, "services");
      if (!isMap(services)) {
        continue;
      }
      for (const pair of services.items) {
        if (!isMap(pair.value)) {
          continue;
        }
        const image = getScalarValue(pair.value, "image");
        if (
          typeof image !== "string" ||
          !/^(?:docker\.io\/)?localstack\/localstack(?:-pro)?(?::[\w.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/.test(
            image,
          )
        ) {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, getNode(pair.value, "image"), {
            message: `Job "${job.id}" uses LocalStack service "${getScalarString(pair.key)}" (${image}); evaluate Floci, MiniStack, or fakecloud for local AWS emulation.`,
            why: "Floci, MiniStack, and fakecloud provide alternative local AWS emulators with different startup, image, and memory footprints. Existing OSS projects have migrated real integration suites to these tools. Savings and AWS behavior compatibility depend on the services, operations, runtimes, and cross-service flows exercised; LocalStack use alone does not prove a slowdown.",
            suggestion:
              "Evaluate Floci, MiniStack, and fakecloud against the existing integration suite, then migrate to a compatible option if measured startup, image-pull, memory, or test costs improve. Pin a released image, review licensing (including fakecloud's AGPL-3.0), and preserve test coverage. Do not blindly swap images or weaken assertions.",
            measurementHint:
              "Compare cold image-pull time, readiness time, peak memory including child containers, and complete integration-test duration on equivalent runners. Verify Lambda execution, persistence, IAM behavior, and cross-service event delivery where used.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and its LocalStack service ${image}. Inventory required AWS operations and cross-service flows. Compare Floci, MiniStack, and fakecloud using the unchanged integration suite, check licensing and runtime requirements, and migrate only after compatibility and performance validation. Preserve endpoints, readiness checks, isolation, and coverage; do not auto-replace with an API-only mock.`,
            score: 50,
          }),
        );
        break;
      }
    }
    return findings;
  },
};
