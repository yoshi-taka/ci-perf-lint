import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";
import { getNode, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { shellCommands } from "./shared/command-patterns.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const safeOptionFlags = new Set([
  "--init",
  "--interactive",
  "--no-healthcheck",
  "--rm",
  "--tty",
  "-i",
  "-t",
]);

const safeOptionValues = new Set([
  "--add-host",
  "--dns",
  "--dns-option",
  "--dns-search",
  "--expose",
  "--health-cmd",
  "--health-interval",
  "--health-retries",
  "--health-start-interval",
  "--health-start-period",
  "--health-timeout",
  "--hostname",
  "--label",
  "--log-driver",
  "--log-opt",
  "--name",
  "--network",
  "--network-alias",
  "--platform",
  "--publish",
  "--pull",
  "--restart",
  "--stop-signal",
  "--stop-timeout",
  "-h",
  "-p",
]);

function optionsArePreservable(options: string): boolean {
  const commands = shellCommands(options);
  if (commands.length !== 1) {
    return false;
  }
  const words = commands[0] ?? [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!;
    if (!word.startsWith("-")) {
      return false;
    }
    const option = word.split("=")[0]!;
    if (safeOptionFlags.has(option)) {
      continue;
    }
    if (!safeOptionValues.has(option)) {
      return false;
    }
    if (!word.includes("=")) {
      if (!words[index + 1] || words[index + 1]!.startsWith("-")) {
        return false;
      }
      index++;
    }
  }
  return true;
}

function elasticmqServices(workflow: WorkflowDocument) {
  return workflow.jobs.flatMap((job) => {
    if (jobIsStaticallyDisabled(job)) {
      return [];
    }
    const services = getNode(job.node, "services");
    if (!isMap(services)) {
      return [];
    }
    return services.items.flatMap((pair) => {
      if (!isMap(pair.value)) {
        return [];
      }
      const image = getScalarValue(pair.value, "image");
      if (typeof image !== "string") {
        return [];
      }
      const match =
        /^(?:docker\.io\/)?softwaremill\/elasticmq(-native)?(?::(\d+\.\d+\.\d+|latest))?$/.exec(
          image,
        );
      return match
        ? [{ job, service: pair.value, image, native: Boolean(match[1]), version: match[2] }]
        : [];
    });
  });
}

const versionMeta = {
  id: "prefer-elasticmq-1-3-5",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-elasticmq-1-3-5.md",
} satisfies RuleMeta;

export const preferElasticmq135Rule = {
  meta: versionMeta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const add = (
      image: string,
      node: Parameters<typeof buildDiagnostic>[2],
      jobLabel: string,
      message: string,
    ): void => {
      const match = /^(?:docker\.io\/)?softwaremill\/elasticmq(?:-native)?:(\d+\.\d+\.\d+)$/.exec(
        image,
      );
      if (!match || versionSpecIsBelow(match[1]!, [1, 3, 5]) !== true) {
        return;
      }
      findings.push(
        buildDiagnostic(workflow, versionMeta, node, {
          message,
          why: "ElasticMQ 1.3.5 replaces repeated copying of the complete message-id map with direct lookups and value iteration. Earlier versions could have very low receive throughput as retained queue depth grows, affecting standard and FIFO workloads. The upstream report describes the problem, not a measured before/after CI speedup; small queues may show little difference.",
          suggestion:
            "Upgrade ElasticMQ to 1.3.5 or a later compatible stable release while preserving JVM/native image variant, endpoints, queue attributes, persistence, and verification. Review native-specific release fixes if using the native variant; do not reset queues or remove retained-message test coverage to hide the slowdown.",
          measurementHint:
            "Compare receive, delete, and visibility-change latency at equivalent retained queue depths, plus total integration-test duration and memory. Keep FIFO ordering, visibility, DLQ, and persistence assertions unchanged where used.",
          aiHandoff: `Review ${workflow.relativePath} job "${jobLabel}" and upgrade ${image} to ElasticMQ 1.3.5 or later after compatibility checks. Keep the image variant, queue configuration, retained-message fixtures, and persistence semantics. Compare queue-depth-sensitive operations rather than just startup.`,
          score: 50,
        }),
      );
    };
    for (const { job, service, image } of elasticmqServices(workflow)) {
      add(
        image,
        getNode(service, "image"),
        job.id,
        `Job "${job.id}" pins ${image}, below the ElasticMQ 1.3.5 queue-lookup performance fix.`,
      );
    }
    for (const run of dockerImageRuns(
      workflow,
      /^(?:docker\.io\/)?softwaremill\/elasticmq(?:-native)?:\d+\.\d+\.\d+$/,
    )) {
      add(
        run.image,
        run.node,
        run.jobName,
        `Job "${run.jobName}" runs ${run.image}, below the ElasticMQ 1.3.5 queue-lookup performance fix.`,
      );
    }
    return findings;
  },
};

const nativeMeta = {
  id: "prefer-elasticmq-native-image",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-elasticmq-native-image.md",
} satisfies RuleMeta;

export const preferElasticmqNativeImageRule = {
  meta: nativeMeta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    return elasticmqServices(workflow)
      .filter(
        ({ service, native, version }) =>
          !native &&
          (version === undefined ||
            version === "latest" ||
            versionSpecIsBelow(version, [1, 6, 7]) === false) &&
          getNode(service, "env") === undefined &&
          getNode(service, "volumes") === undefined &&
          getNode(service, "command") === undefined &&
          (getScalarValue(service, "options") === undefined ||
            optionsArePreservable(String(getScalarValue(service, "options")))),
      )
      .map(({ job, service, image }) =>
        buildDiagnostic(workflow, nativeMeta, getNode(service, "image"), {
          message: `Job "${job.id}" starts the JVM ElasticMQ image ${image} without runtime-changing service customization; evaluate softwaremill/elasticmq-native.`,
          why: "ElasticMQ publishes a GraalVM-compiled native server, also used by the upstream Docker Compose example. It avoids JVM startup and JIT warm-up and can reduce startup/resource overhead for short CI services. No equivalent-workload startup, memory, or whole-suite speedup was independently measured; native mode is not assumed to improve steady-state throughput.",
          suggestion:
            "Benchmark a compatible released softwaremill/elasticmq-native image, pinning its own tag or digest. Use 1.6.7 or later to include native config-path, persistence, and DLQ-listing fixes. Preserve endpoints, queue semantics, readiness, and test coverage; retain the JVM image when runtime customization or measured behavior requires it. Do not copy a JVM image digest to the native repository.",
          measurementHint:
            "Compare cold image pull, readiness, peak memory, and complete test duration on the same runner architecture and release. Verify queue creation, send/receive/delete, visibility, FIFO, DLQ, and persistence behavior where used; do not extrapolate generic GraalVM benchmarks to ElasticMQ.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and compare ${image} with a compatible pinned softwaremill/elasticmq-native release at least 1.6.7. Validate architecture and native-specific release notes; preserve endpoints, queue semantics, readiness, and assertions. Keep the JVM image if native changes behavior or does not improve measured CI costs.`,
          score: 45,
        }),
      );
  },
};
