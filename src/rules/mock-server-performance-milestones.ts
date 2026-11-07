import { isMap } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { versionSpecIsBelow } from "../repository-dependency-versions.ts";
import { getNode, getScalarString, getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { dockerImageRuns } from "./shared/docker-image-runs.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

interface MockServerMilestone {
  meta: Pick<RuleMeta, "id" | "docsPath">;
  name: string;
  image: RegExp;
  version: readonly [number, number, number];
  why: string;
  migration: string;
}

function createMockServerMilestoneRule(config: MockServerMilestone) {
  const target = config.version.join(".");
  const meta = {
    ...config.meta,
    severity: "warning",
    confidence: "medium",
  } satisfies RuleMeta;
  return {
    meta,
    check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
      const findings: Diagnostic[] = [];
      const add = (
        image: string,
        node: Parameters<typeof buildDiagnostic>[2],
        message: string,
      ): void => {
        const match = config.image.exec(image);
        if (!match || versionSpecIsBelow(match[1]!, config.version) !== true) {
          return;
        }
        findings.push(
          buildDiagnostic(workflow, meta, node, {
            message,
            why: config.why,
            suggestion: `Upgrade ${config.name} to ${target} or a later compatible stable release. Preserve image variant, stub mappings, extensions, readiness checks, request verification, and test isolation. ${config.migration}`,
            measurementHint:
              "Compare cold image-pull time, service readiness, peak memory, request-matching latency, and total integration-test duration on equivalent runners. Keep response and request-verification assertions unchanged; upstream microbenchmarks are not predicted whole-job savings.",
            aiHandoff: `Review ${workflow.relativePath} and upgrade ${config.name} image ${image} to at least ${target}, review migration and runtime requirements, and preserve mappings, extensions, journal/verification behavior, readiness, and test coverage. ${config.migration}`,
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
          if (typeof image !== "string") {
            continue;
          }
          add(
            image,
            getNode(pair.value, "image"),
            `Job "${job.id}" service "${getScalarString(pair.key)}" pins ${image}, below the ${config.name} ${target} performance milestone.`,
          );
        }
      }
      for (const run of dockerImageRuns(workflow, config.image)) {
        add(
          run.image,
          run.node,
          `Job "${run.jobName}" runs ${run.image}, below the ${config.name} ${target} performance milestone.`,
        );
      }
      return findings;
    },
  };
}

export const preferWiremock311Rule = createMockServerMilestoneRule({
  meta: {
    id: "prefer-wiremock-3-11",
    docsPath: "docs/rules/prefer-wiremock-3-11.md",
  },
  name: "WireMock",
  image: /^(?:docker\.io\/)?wiremock\/wiremock:(\d+\.\d+\.\d+)(?:-\d+)?$/,
  version: [3, 11, 0],
  why: "WireMock 3.11 avoids a memory-intensive XSLT transform when ignoring XML comments in equalToXml matching. Earlier 3.x releases fixed a request-matching regression (3.4.2), cached parsed JSON and evaluated JSONPath values per request (3.5), and bounded the default response-template cache (3.7). These are cumulative, workload-specific changes, not a universal speedup for every stub or CI job.",
  migration:
    "When crossing from 2.x, review Java 11+, Jetty/extension compatibility, and response-template configuration changes. Do not disable the request journal when tests need verification.",
});

export const preferMockserver91Rule = createMockServerMilestoneRule({
  meta: {
    id: "prefer-mockserver-9-1",
    docsPath: "docs/rules/prefer-mockserver-9-1.md",
  },
  name: "MockServer",
  image: /^(?:docker\.io\/)?mockserver\/mockserver:(\d+\.\d+\.\d+)(?:-\d+)?$/,
  version: [9, 1, 0],
  why: "MockServer 9.0 reduced retained event-log memory, shrank image downloads, and changed the Docker GC/runtime configuration as part of a throughput and latency improvement programme. Version 9.1 reduces log-message formatting CPU and allocation costs and lowers the default INFO event-log memory budget. Upstream measurements combine runtime, GC, and implementation changes and do not predict CI speedups; retained request history is shorter by default.",
  migration:
    "Review the 9.x migration guide, client/server compatibility, TLS and browser-origin requirements, JVM flags, and event-log retention. Explicitly size history if request verification relies on older entries; do not bypass security or weaken assertions for performance.",
});
