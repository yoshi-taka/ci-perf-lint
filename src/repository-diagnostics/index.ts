import { collectGradleParallelNotEnabledDiagnostics } from "./gradle-parallel-not-enabled.ts";
import type { Diagnostic } from "../types.ts";
import type { GatedContext, GateKey, RepositoryDiagnosticContext } from "./collector-types.ts";
import { assertGateProof, collectorRequiresAllGates } from "./collector-types.ts";
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
} from "./collectors-foundation.ts";
import { javascriptDiagnosticCollectors } from "./collectors-javascript.ts";
import { pytestDiagnosticCollectors, pythonDiagnosticCollectors } from "./collectors-python.ts";
import { terraformDiagnosticCollectors } from "./collectors-terraform.ts";
import { buildGateProofs, collectRepositoryDiagnosticGateState, gateKeys } from "./gates.ts";

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
  {
    id: "gradle-parallel-not-enabled",
    gate: gateKeys.gradle,
    collect: (context: GatedContext<"hasGradle">) =>
      collectGradleParallelNotEnabledDiagnostics(context),
  } as const,
] as const;

interface CollectorLike {
  id: string;
  gate?: GateKey;
  gates?: readonly GateKey[];
  collect: (ctx: unknown) => Diagnostic[] | Promise<Diagnostic[]>;
}

function runRepositoryDiagnosticCollector(
  collector: CollectorLike,
  context: RepositoryDiagnosticContext,
  proofs: ReturnType<typeof buildGateProofs>,
): Diagnostic[] | Promise<Diagnostic[]> {
  if (collector.gates) {
    for (const g of collector.gates) {
      assertGateProof(g, proofs);
    }
  } else if (collector.gate) {
    assertGateProof(collector.gate, proofs);
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
  const { state: gateState, observability: gateObservability } = gateResolution;
  const gateElapsed = performance.now() - gateStateStartedAt;
  const proofs = buildGateProofs(gateState);
  const applicableCollectors = repositoryDiagnosticCollectors.filter((collector) =>
    collectorRequiresAllGates(collector, gateState),
  );
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
    context.warnings.push({
      kind: "gate-skipped",
      source: collector.id,
      message: `Collector ${collector.id} was not run because its gate did not match.`,
    });
  }
  if (timingsEnabled()) {
    process.stderr.write(
      `[timing] diagnostics gates=${gateElapsed.toFixed(1)}ms collectors=${applicableCollectors.length}\n`,
    );
  }

  const results = await Promise.allSettled(
    scheduledCollectors.map((collector) => {
      const startedAt = performance.now();
      const result = runRepositoryDiagnosticCollector(collector as CollectorLike, context, proofs);
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
  const diagnostics: Diagnostic[] = [];
  const firedCollectors = new Set<string>();

  for (const [index, result] of results.entries()) {
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
    const collectorResults = scheduledCollectors.map((c, i) => {
      const r = results[i];
      return {
        id: c.id,
        gate: c.gate,
        gates: (c as CollectorLike).gates,
        findings: r?.status === "fulfilled" ? r.value.length : -1,
        error: r?.status === "rejected" ? String(r.reason) : undefined,
      };
    });
    process.stderr.write(
      JSON.stringify({
        type: "repo-diagnostics-state",
        activeGates,
        collectorCount: applicableCollectors.length,
        totalCollectors: repositoryDiagnosticCollectors.length,
        collectors: collectorResults,
        collectorCooccurrence: buildCollectorCooccurrenceDebug([...firedCollectors]),
        collectorSchedule,
        gateObservability,
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
