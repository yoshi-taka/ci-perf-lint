import { collectBundlerExternalSubpathLeakDiagnostics } from "./bundler-external-subpath-leak.ts";
import { collectGradleParallelNotEnabledDiagnostics } from "./gradle-parallel-not-enabled.ts";
import { collectJvmCdsOpportunityDiagnostics } from "./jvm-cds-opportunity.ts";
import type { Diagnostic } from "../types.ts";
import type { GatedContext, GateKey, RepositoryDiagnosticContext } from "./collector-types.ts";
import {
  assertGateProof,
  buildTypedContext,
  collectorRequiresAllGatesFromResults,
} from "./collector-types.ts";
import type { GateExpr } from "./gate-expr.ts";
import { gateExprToString } from "./gate-expr.ts";
import {
  buildCollectorCooccurrenceDebug,
  orderCollectorsForDiagnostics,
} from "./collector-cooccurrence.ts";
import { cdkDiagnosticCollectors } from "./collectors-cdk.ts";
import {
  datadogDiagnosticCollectors,
  dockerDiagnosticCollectors,
  elixirDiagnosticCollectors,
  largeFileDiagnosticCollectors,
  toolDiagnosticCollectors,
} from "./collectors-foundation.ts";
import { javascriptDiagnosticCollectors } from "./collectors-javascript.ts";
import { pytestDiagnosticCollectors, pythonDiagnosticCollectors } from "./collectors-python.ts";
import { terraformDiagnosticCollectors } from "./collectors-terraform.ts";
import { buildGateProofs, collectRepositoryDiagnosticGateState, gateKeys } from "./gates.ts";
import { ResourceRegistry } from "./resource-registry.ts";
import { ResourceCache } from "./resource-cache.ts";
import { ResourceEvaluator } from "./resource-evaluator.ts";
import type { ResourceEvaluationObservability } from "./semantic-resource.ts";
import { registerDefaultResources } from "./resources/index.ts";

const resourceRegistry: ResourceRegistry = new ResourceRegistry();
registerDefaultResources(resourceRegistry);

export const repositoryDiagnosticCollectors = [
  ...javascriptDiagnosticCollectors,
  ...dockerDiagnosticCollectors,
  ...largeFileDiagnosticCollectors,
  ...datadogDiagnosticCollectors,
  ...terraformDiagnosticCollectors,
  ...pytestDiagnosticCollectors,
  ...pythonDiagnosticCollectors,
  ...cdkDiagnosticCollectors,
  ...elixirDiagnosticCollectors,
  ...toolDiagnosticCollectors,
  {
    id: "bundler-external-subpath-leak",
    gate: gateKeys.javascriptTooling,
    collect: (context: GatedContext<"hasJavaScriptTooling">) =>
      collectBundlerExternalSubpathLeakDiagnostics(context),
  } as const,
  {
    id: "gradle-parallel-not-enabled",
    gate: gateKeys.gradle,
    collect: (context: GatedContext<"hasGradle">) =>
      collectGradleParallelNotEnabledDiagnostics(context),
  } as const,
  {
    id: "jvm-cds-opportunity-for-repeated-startup",
    gate: gateKeys.jvm,
    collect: (context: GatedContext<"hasJvm">) => collectJvmCdsOpportunityDiagnostics(context),
  } as const,
] as const;

interface CollectorLike {
  id: string;
  gate?: GateKey;
  gates?: readonly GateKey[];
  gateExpr?: GateExpr<GateKey>;
  collect: (ctx: RepositoryDiagnosticContext) => Diagnostic[] | Promise<Diagnostic[]>;
}

function runRepositoryDiagnosticCollector(
  collector: CollectorLike,
  context: RepositoryDiagnosticContext,
  proofs: ReturnType<typeof buildGateProofs>,
): Diagnostic[] | Promise<Diagnostic[]> {
  if (collector.gate) {
    const gateTrue = assertGateProof(collector.gate, proofs);
    return collector.collect(buildTypedContext(context, collector.gate, gateTrue.__proof));
  }
  if (collector.gates) {
    for (const g of collector.gates) {
      assertGateProof(g, proofs);
    }
  }
  return collector.collect(context);
}

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

function dumpStateEnabled(): boolean {
  return process.env.CI_PERF_LINT_DUMP_STATE === "1";
}

function extractSignals(
  repository: RepositoryDiagnosticContext["repository"],
): Record<string, unknown> {
  return {
    usesGradle: repository.frameworks.usesGradle,
    usesDocker: repository.looksLargeOrComplex,
    hasHusky: repository.husky.hookFileCount > 0,
    workflowCount: repository.workflowCount,
    heavyWorkflowCount: repository.heavyWorkflowCount,
  };
}

export async function collectRepositoryDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const gateStateStartedAt = performance.now();
  const gateResolution = await collectRepositoryDiagnosticGateState(context);
  const {
    state: gateState,
    observability: gateObservability,
    results: gateResults,
  } = gateResolution;
  const gateElapsed = performance.now() - gateStateStartedAt;
  const proofs = buildGateProofs(gateState);

  const collectorGateResults = new Map(
    repositoryDiagnosticCollectors.map(
      (c) => [c.id, collectorRequiresAllGatesFromResults(c as CollectorLike, gateResults)] as const,
    ),
  );

  const applicableCollectors = repositoryDiagnosticCollectors.filter((collector) => {
    const r = collectorGateResults.get(collector.id)!;
    return r.status === "resolved" && r.value;
  });

  const collectorSchedule =
    applicableCollectors.length > 1
      ? orderCollectorsForDiagnostics(applicableCollectors.map((collector) => collector.id))
      : undefined;
  const scheduleByCollector = new Map(
    collectorSchedule?.schedule.map((entry) => [entry.collector, entry.score]) ?? [],
  );
  const scheduledCollectors = collectorSchedule
    ? [...applicableCollectors].sort((left, right) => {
        const leftPriority = scheduleByCollector.get(left.id) ?? 0;
        const rightPriority = scheduleByCollector.get(right.id) ?? 0;
        if (rightPriority !== leftPriority) {
          return rightPriority - leftPriority;
        }
        return left.id.localeCompare(right.id);
      })
    : applicableCollectors;

  for (const collector of repositoryDiagnosticCollectors) {
    if (applicableCollectors.includes(collector)) {
      continue;
    }
    context.measureCompleteness?.skippedGates.add(collector.id);
    const r = collectorGateResults.get(collector.id)!;
    if (r.status === "resolved") {
      context.warnings.push({
        kind: "gate-skipped",
        source: collector.id,
        message: `Collector ${collector.id} was not run because its gate resolved false.`,
      });
    } else {
      context.warnings.push({
        kind: "gate-skipped",
        source: collector.id,
        message: `Collector ${collector.id} was not run: ${r.reason}`,
      });
    }
  }
  if (timingsEnabled()) {
    process.stderr.write(
      `[timing] diagnostics gates=${gateElapsed.toFixed(1)}ms collectors=${applicableCollectors.length}\n`,
    );
  }

  const resourceCache = new ResourceCache();
  const resourceEvaluator = new ResourceEvaluator(resourceRegistry, resourceCache);
  const resourceObservability: ResourceEvaluationObservability = {
    resources: [],
    evaluationOrder: [],
    cacheHits: 0,
    cacheMisses: 0,
  };
  const getResource = await resourceEvaluator.evaluate(context, [], {
    observability: resourceObservability,
  });
  const resourceContext: RepositoryDiagnosticContext = {
    ...context,
    getResource,
  };

  const resourceTimingStartedAt = performance.now();

  const collectorResults = await Promise.allSettled(
    scheduledCollectors.map((collector) => {
      const startedAt = performance.now();
      const result = runRepositoryDiagnosticCollector(
        collector as CollectorLike,
        resourceContext,
        proofs,
      );
      if (result instanceof Promise) {
        if (timingsEnabled()) {
          return result.then((value) => {
            process.stderr.write(
              `[timing] diagnostics collector ${collector.id}=${(performance.now() - startedAt).toFixed(1)}ms findings=${value.length}\n`,
            );
            return value;
          });
        }
        return result;
      }
      return Promise.resolve(result);
    }),
  );

  if (timingsEnabled() && resourceObservability.cacheMisses > 0) {
    process.stderr.write(
      `[timing] resources evaluated=${resourceObservability.cacheMisses} cached=${resourceObservability.cacheHits} total=${(performance.now() - resourceTimingStartedAt).toFixed(1)}ms\n`,
    );
  }
  const diagnostics: Diagnostic[] = [];
  const firedCollectors = new Set<string>();

  for (const [index, result] of collectorResults.entries()) {
    if (result.status === "fulfilled") {
      if (result.value.length === 0) {
        const collector = scheduledCollectors[index];
        context.warnings.push({
          kind: "empty-result",
          source: collector?.id ?? "unknown",
          message: `Collector ${collector?.id ?? "unknown"} ran and found nothing.`,
        });
      }
      if (result.value.length > 0) {
        firedCollectors.add(scheduledCollectors[index]?.id ?? "unknown");
      }
      diagnostics.push(...result.value);
      continue;
    }

    const collector = scheduledCollectors[index];
    const detail = result.reason instanceof Error ? result.reason.message : String(result.reason);
    context.warnings.push({
      kind: "collector-error",
      source: "collectRepositoryDiagnostics",
      message: `Collector ${collector?.id ?? "unknown"} failed: ${detail}`,
    });
  }

  if (dumpStateEnabled()) {
    const activeGates = Object.entries(gateState)
      .filter(([_, v]) => v)
      .map(([k]) => k.replace(/^has/, ""));
    const collectorResultsDump = scheduledCollectors.map((c, i) => {
      const r = collectorResults[i];
      const collectorLike = c as CollectorLike;
      return {
        id: c.id,
        gate: collectorLike.gate,
        gates: collectorLike.gates,
        gateExpr: collectorLike.gateExpr ? gateExprToString(collectorLike.gateExpr) : undefined,
        findings: r?.status === "fulfilled" ? r.value.length : -1,
        error: r?.status === "rejected" ? String(r.reason) : undefined,
      };
    });
    process.stderr.write(
      JSON.stringify({
        type: "repo-diagnostics-state",
        activeGates,
        gateResults,
        resourceAccessLog: context.featureIndex.resourceAccessLog,
        collectorCount: applicableCollectors.length,
        totalCollectors: repositoryDiagnosticCollectors.length,
        collectors: collectorResultsDump,
        collectorCooccurrence: buildCollectorCooccurrenceDebug([...firedCollectors]),
        collectorSchedule,
        gateObservability,
        semanticResources:
          resourceObservability.resources.length > 0 ? resourceObservability : undefined,
        signals: extractSignals(context.repository),
        warnings: context.warnings,
        measureCompleteness: context.measureCompleteness
          ? {
              totalWorkflows: context.measureCompleteness.totalWorkflows,
              evaluatedWorkflows: context.measureCompleteness.evaluatedWorkflowPaths.size,
              skippedRepositoryDiagnostics:
                context.measureCompleteness.skippedRepositoryDiagnostics,
              skippedGates: [...context.measureCompleteness.skippedGates].sort(),
              maxFindingsHitRules: [...context.measureCompleteness.maxFindingsHitRules].sort(),
              parserFailures:
                context.measureCompleteness.parserFailures.size > 0
                  ? [...context.measureCompleteness.parserFailures].sort()
                  : undefined,
              workflowOnlyRules:
                context.measureCompleteness.workflowOnlyRules.size > 0
                  ? [...context.measureCompleteness.workflowOnlyRules].sort()
                  : undefined,
            }
          : undefined,
        totalFindings: diagnostics.length,
      }),
    );
    process.stderr.write("\n");
  }

  return diagnostics;
}
