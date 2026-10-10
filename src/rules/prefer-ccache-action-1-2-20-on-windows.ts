import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument, type WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { getRunsOnSpec } from "./shared/runs-on-facts.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import { jobAllowsActionsCacheRestore } from "./shared/workflow-caches.ts";
import { workflowStepEnv } from "./shared/workflow-command-context.ts";

const meta = {
  id: "prefer-ccache-action-1-2-20-on-windows",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-ccache-action-1-2-20-on-windows.md",
} satisfies RuleMeta;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function jobHasWindowsRunner(job: WorkflowJob): boolean {
  const runner = getRunsOnSpec(job);
  if (runner.labels.includes("self-hosted")) {
    return false;
  }
  if (runner.isWindows) {
    return true;
  }
  const matrix = asRecord(asRecord(job.raw.strategy)?.matrix);
  if (!matrix) {
    return false;
  }
  const rawRunner = job.raw["runs-on"];
  const labels =
    typeof rawRunner === "string"
      ? [rawRunner]
      : Array.isArray(rawRunner)
        ? rawRunner.filter((label): label is string => typeof label === "string")
        : [];
  return labels.some((label) => {
    const field = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(label)?.[1];
    if (!field) {
      return false;
    }
    const excluded = Array.isArray(matrix.exclude) ? matrix.exclude.map(asRecord) : [];
    const values = Array.isArray(matrix[field])
      ? matrix[field].filter(
          (value) =>
            !excluded.some(
              (entry) => entry && Object.keys(entry).length === 1 && entry[field] === value,
            ),
        )
      : [];
    const included = Array.isArray(matrix.include)
      ? matrix.include.map((entry) => asRecord(entry)?.[field])
      : [];
    return [...values, ...included].some(
      (value) => typeof value === "string" && /^windows-(?:latest|\d{4})(?:-|$)/i.test(value),
    );
  });
}

export const preferCcacheAction1220OnWindowsRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        jobIsStaticallyDisabled(job) ||
        !jobHasWindowsRunner(job) ||
        !jobAllowsActionsCacheRestore(workflow, job)
      ) {
        continue;
      }
      const offenders = job.steps.filter((step) => {
        const variant = step.with?.variant;
        return (
          cacheActionVersionIsBelow(step, "hendrikmuhs/ccache-action", [1, 2, 20]) &&
          (variant === undefined || variant === "ccache") &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false" &&
          !/runner\.os\s*(?:!=\s*['"]Windows['"]|==\s*['"](?:Linux|macOS)['"])/i.test(
            step.if ?? "",
          ) &&
          workflowStepEnv(workflow, job, step).CCACHE_COMPILERCHECK === undefined
        );
      });
      const anchor = offenders[0];
      if (
        !anchor ||
        job.steps.some((step) =>
          /\bccache\s+--set-config(?:=|\s+)compiler_check=content\b/.test(step.run ?? ""),
        )
      ) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" uses ccache-action below 1.2.20 on a Windows runner: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "ccache-action 1.2.20 configures compiler_check=content on Windows. Visual Studio installations on different hosted runner images can give the same cl.exe different modification times, causing unnecessary cache misses or duplicate cache entries with older action defaults.",
          suggestion:
            "Upgrade hendrikmuhs/ccache-action to v1.2.20 or a later compatible release. Preserve cache keys and sizes, keep the ccache variant, and verify that Windows compiler checks use content rather than modification time.",
          measurementHint:
            "Compare ccache hit/miss statistics and warm compilation duration across fresh Windows runners. Content hashing adds some overhead, so measure total build time.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade the old ccache-action refs for Windows legs to v1.2.20 or later. Preserve matrix conditions and cache inputs, verify compiler_check=content, and compare ccache statistics.`,
          score: 55,
        }),
      );
    }
    return findings;
  },
};
