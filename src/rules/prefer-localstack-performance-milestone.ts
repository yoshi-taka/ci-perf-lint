import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-localstack-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-localstack-performance-milestone.md",
} satisfies RuleMeta;

const imagePattern = /^(?:docker\.io\/)?localstack\/localstack(?:-pro)?:(\d+)\.(\d+)\.(\d+)$/;

function milestone(
  major: number,
  minor: number,
  names: readonly string[],
): { target: string; why: string } | undefined {
  if (major < 2) {
    return {
      target: "2.0",
      why: "LocalStack 2.0 separated Community and Pro images, substantially reducing image sizes, and introduced a faster Lambda provider. Published service benchmarks are not predicted CI savings.",
    };
  }
  if (major < 3 && names.some((name) => name === "s3" || name === "dynamodb")) {
    return {
      target: "3.0",
      why: "LocalStack 3.0 made the native S3 provider the default, improving throughput and large-object memory use, and improved DynamoDB write performance.",
    };
  }
  if ((major < 4 || minor < 1) && names.includes("events")) {
    return {
      target: "4.1",
      why: "LocalStack 4.1 replaced the Java event-rule engine with a native Python engine, removing the Java runtime dependency for event pattern matching.",
    };
  }
  if ((major < 4 || minor < 6) && names.includes("appsync")) {
    return {
      target: "4.6",
      why: "LocalStack 4.6 replaced Docker-based AppSync JavaScript resolver execution with a lightweight Node.js runtime. The release reports execution dropping from over one second to single-digit milliseconds; actual CI savings depend on JavaScript resolver use.",
    };
  }
  return undefined;
}

function servicesFromDockerRun(words: readonly string[]): string[] {
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    let value: string | undefined;
    if (word === "-e" || word === "--env") {
      value = words[index + 1];
      index++;
    } else if (word.startsWith("--env=SERVICES=") || word.startsWith("-e=SERVICES=")) {
      value = word.slice(word.indexOf("=") + 1);
    } else if (word.startsWith("SERVICES=")) {
      value = word;
    }
    if (value?.startsWith("SERVICES=")) {
      return value
        .slice("SERVICES=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export const preferLocalstackPerformanceMilestoneRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const add = (
      image: string,
      node: Parameters<typeof buildDiagnostic>[2],
      jobLabel: string,
      serviceLabel: string | undefined,
      names: readonly string[],
    ): void => {
      const version = imagePattern.exec(image);
      if (!version) {
        return;
      }
      const major = Number(version[1]);
      const minor = Number(version[2]);
      if (major > 4) {
        return;
      }
      const target = milestone(major, minor, names);
      if (!target) {
        return;
      }
      const subject = serviceLabel ? `service "${serviceLabel}" pins` : "runs";
      findings.push(
        buildDiagnostic(workflow, meta, node, {
          message: `Job "${jobLabel}" ${subject} ${image}, below the LocalStack ${target.target} performance milestone.`,
          why: target.why,
          suggestion: `Upgrade the LocalStack runtime image to at least ${target.target}.x within the 4.x ceiling. Preserve the image edition and review provider, networking, persistence, and Lambda migration requirements. Do not migrate to calendar-versioned releases.`,
          measurementHint:
            "Compare image pull, service readiness, and integration-test wall-clock times; verify service behavior and test results remain correct.",
          aiHandoff: `Review ${workflow.relativePath} job "${jobLabel}" and LocalStack image ${image}. Upgrade to at least ${target.target}.x, never beyond 4.x. Preserve edition and service configuration, review migration guides and intentional compatibility pins, then run integration tests.`,
          score: 55,
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
        if (typeof image !== "string") {
          continue;
        }
        const env = getNode(pair.value, "env");
        const enabled = isMap(env) ? getScalarValue(env, "SERVICES") : undefined;
        const names =
          typeof enabled === "string" ? enabled.split(",").map((name) => name.trim()) : [];
        add(image, getNode(pair.value, "image"), job.id, getScalarString(pair.key), names);
      }
    }
    for (const run of dockerImageRuns(workflow, imagePattern)) {
      add(run.image, run.node, run.jobName, undefined, servicesFromDockerRun(run.words));
    }
    return findings;
  },
};
