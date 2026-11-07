import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-localstack-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-localstack-performance-milestone.md",
} satisfies RuleMeta;

export const preferLocalstackPerformanceMilestoneRule = {
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
        if (typeof image !== "string") {
          continue;
        }
        const version =
          /^(?:docker\.io\/)?localstack\/localstack(?:-pro)?:(\d+)\.(\d+)\.(\d+)$/.exec(image);
        if (!version) {
          continue;
        }
        const major = Number(version[1]);
        const minor = Number(version[2]);
        if (major > 4) {
          continue;
        }
        const env = getNode(pair.value, "env");
        const enabled = isMap(env) ? getScalarValue(env, "SERVICES") : undefined;
        const names =
          typeof enabled === "string" ? enabled.split(",").map((name) => name.trim()) : [];
        let target: string;
        let why: string;
        if (major < 2) {
          target = "2.0";
          why =
            "LocalStack 2.0 separated Community and Pro images, substantially reducing image sizes, and introduced a faster Lambda provider. Published service benchmarks are not predicted CI savings.";
        } else if (major < 3 && names.some((name) => name === "s3" || name === "dynamodb")) {
          target = "3.0";
          why =
            "LocalStack 3.0 made the native S3 provider the default, improving throughput and large-object memory use, and improved DynamoDB write performance.";
        } else if ((major < 4 || minor < 1) && names.includes("events")) {
          target = "4.1";
          why =
            "LocalStack 4.1 replaced the Java event-rule engine with a native Python engine, removing the Java runtime dependency for event pattern matching.";
        } else if ((major < 4 || minor < 6) && names.includes("appsync")) {
          target = "4.6";
          why =
            "LocalStack 4.6 replaced Docker-based AppSync JavaScript resolver execution with a lightweight Node.js runtime. The release reports execution dropping from over one second to single-digit milliseconds; actual CI savings depend on JavaScript resolver use.";
        } else {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, getNode(pair.value, "image"), {
            message: `Job "${job.id}" service "${getScalarString(pair.key)}" pins ${image}, below the LocalStack ${target} performance milestone.`,
            why,
            suggestion: `Upgrade the LocalStack runtime image to at least ${target}.x within the 4.x ceiling. Preserve the image edition and review provider, networking, persistence, and Lambda migration requirements. Do not migrate to calendar-versioned releases.`,
            measurementHint:
              "Compare image pull, service readiness, and integration-test wall-clock times; verify service behavior and test results remain correct.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" service image ${image}. Upgrade to at least ${target}.x, never beyond 4.x. Preserve edition and service configuration, review migration guides and intentional compatibility pins, then run integration tests.`,
            score: 55,
          }),
        );
      }
    }
    return findings;
  },
};
