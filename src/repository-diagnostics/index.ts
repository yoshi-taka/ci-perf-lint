import { collectGradleParallelNotEnabledDiagnostics } from "./gradle-parallel-not-enabled.ts";
import type { Diagnostic } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
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
import { collectorGateMatches, collectRepositoryDiagnosticGateState, gates } from "./gates.ts";

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
    gate: gates.gradle,
    collect: (context: RepositoryDiagnosticContext) =>
      collectGradleParallelNotEnabledDiagnostics(context),
  },
] as const;

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
  const gateState = await collectRepositoryDiagnosticGateState(context);
  const gateElapsed = performance.now() - gateStateStartedAt;
  const applicableCollectors = repositoryDiagnosticCollectors.filter((collector) =>
    collectorGateMatches(collector.gate, gateState),
  );
  if (timingsEnabled()) {
    process.stderr.write(
      `[timing] diagnostics gates=${gateElapsed.toFixed(1)}ms collectors=${applicableCollectors.length}\n`,
    );
  }

  const results = await Promise.allSettled(
    applicableCollectors.map((collector) => {
      const startedAt = performance.now();
      const result = collector.collect(context);
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

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      diagnostics.push(...result.value);
      continue;
    }

    const collector = applicableCollectors[index];
    const detail = result.reason instanceof Error ? result.reason.message : String(result.reason);
    context.warnings.push({
      source: "collectRepositoryDiagnostics",
      message: `Collector ${collector?.id ?? "unknown"} failed: ${detail}`,
    });
  }

  if (dumpStateEnabled()) {
    const activeGates = Object.entries(gateState)
      .filter(([_, v]) => v)
      .map(([k]) => k.replace(/^has/, ""));
    const collectorResults = applicableCollectors.map((c, i) => {
      const r = results[i];
      return {
        id: c.id,
        gate: c.gate,
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
        signals: extractSignals(context.repository),
        totalFindings: diagnostics.length,
      }),
    );
    process.stderr.write("\n");
  }

  return diagnostics;
}
