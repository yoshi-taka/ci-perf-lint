import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-localstack-alternatives",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-localstack-alternatives.md",
} satisfies RuleMeta;

const imagePattern =
  /^(?:docker\.io\/)?localstack\/localstack(?:-pro)?(?::[\w.-]+)?(?:@sha256:[a-fA-F0-9]{64})?$/;

export const preferLocalstackAlternativesRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const reportedJobs = new Set<string>();
    const add = (
      image: string,
      node: Parameters<typeof buildDiagnostic>[2],
      jobLabel: string,
      serviceLabel?: string,
    ): void => {
      if (reportedJobs.has(jobLabel)) {
        return;
      }
      reportedJobs.add(jobLabel);
      const subject = serviceLabel
        ? `uses LocalStack service "${serviceLabel}"`
        : "runs LocalStack via docker run";
      findings.push(
        buildDiagnostic(workflow, meta, node, {
          message: `Job "${jobLabel}" ${subject} (${image}); evaluate AWS Emulator, Floci, MiniStack, or fakecloud for local AWS emulation.`,
          why: "AWS Emulator is a candidate for AWS behavior fidelity and API speed; other alternatives can offer lower memory use and faster CI startup. Floci, MiniStack, and fakecloud provide different startup, image, and memory footprints, with real integration-suite migrations in existing OSS projects. Savings and compatibility depend on the services, operations, runtimes, and cross-service flows exercised; LocalStack use alone does not prove a slowdown.",
          suggestion:
            "Evaluate AWS Emulator for behavior fidelity and API speed alongside Floci, MiniStack, and fakecloud. Other alternatives can use less memory and start faster in CI. Run the existing integration suite, then migrate only if compatibility holds and measured costs improve. Pin a released package or image, review licensing (including fakecloud's AGPL-3.0), and preserve test coverage. Do not blindly swap images or weaken assertions.",
          measurementHint:
            "Compare AWS behavior fidelity, API latency and throughput, cold package-download or image-pull and install time, readiness time, peak memory including child containers, and complete integration-test duration on equivalent runners. Verify Lambda execution, persistence, IAM behavior, and cross-service event delivery where used.",
          aiHandoff: `Review ${workflow.relativePath} job "${jobLabel}" and its LocalStack image ${image}. Inventory required AWS operations and cross-service flows. Compare AWS Emulator, Floci, MiniStack, and fakecloud using the unchanged integration suite. Evaluate AWS Emulator for behavior fidelity and API speed separately from memory and CI startup, where other alternatives can be better. Check licensing and runtime requirements, and migrate only after compatibility and performance validation. Preserve endpoints, readiness checks, isolation, and coverage; do not auto-replace with an API-only mock.`,
          score: 50,
        }),
      );
    };
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
        if (typeof image !== "string" || !imagePattern.test(image)) {
          continue;
        }
        add(image, getNode(pair.value, "image"), job.id, getScalarString(pair.key));
        break;
      }
    }
    for (const run of dockerImageRuns(workflow, imagePattern)) {
      add(run.image, run.node, run.jobName);
    }
    return findings;
  },
};
