import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";

const meta = {
  id: "matrix-test-job-without-test-sharding",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/matrix-test-job-without-test-sharding.md",
} satisfies RuleMeta;

const shardKeyPattern = /(?:^|_)(shard|split|partition|chunk|node_index|ci_node_index)(?:$|_)/i;
const shardValuePattern = /^\d+\/\d+$/;

function getMatrixRecord(job: WorkflowJob): Record<string, unknown> | undefined {
  const strategy = job.raw.strategy;
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
    return undefined;
  }

  const matrix = (strategy as Record<string, unknown>).matrix;
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    return undefined;
  }

  return matrix as Record<string, unknown>;
}

function getShardLikeMatrixKeys(job: WorkflowJob): string[] {
  const matrix = getMatrixRecord(job);
  if (!matrix) {
    return [];
  }

  return Object.entries(matrix)
    .filter(([key, value]) => {
      if (shardKeyPattern.test(key)) {
        return true;
      }

      if (!Array.isArray(value) || value.length < 2) {
        return false;
      }

      return value.every((entry) => typeof entry === "string" && shardValuePattern.test(entry));
    })
    .map(([key]) => key);
}

function stepLooksLikeTestRun(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.run ?? ""}`.trim();
  return /\b(jest|vitest|playwright|cypress|pytest|go test|cargo test|npm test|pnpm test|yarn test|bun test)\b/i.test(
    text,
  );
}

function stepConsumesShardKey(step: WorkflowStep, shardKeys: string[]): boolean {
  const run = step.run ?? "";
  if (!run) {
    return false;
  }

  return shardKeys.some((key) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      new RegExp(`matrix\\.${escapedKey}`, "i").test(run) ||
      new RegExp(`\\b(shard|split|partition|chunk)\\b`, "i").test(run)
    );
  });
}

function getRepresentativeTestStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) => stepLooksLikeTestRun(step));
}

export const matrixTestJobWithoutTestShardingRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (!jobHasMatrix(job) || job.usesReusableWorkflow) {
        continue;
      }

      const shardKeys = getShardLikeMatrixKeys(job);
      if (shardKeys.length === 0) {
        continue;
      }

      const testStep = getRepresentativeTestStep(job);
      if (!testStep) {
        continue;
      }

      if (stepConsumesShardKey(testStep, shardKeys)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, testStep.runNode ?? testStep.node, {
          message: `Job "${job.id}" uses shard-like matrix keys (${shardKeys.join(", ")}) but the visible test command does not appear to consume them.`,
          why: "A shard-like matrix only speeds up test execution if each matrix leg actually runs a different subset of tests. Otherwise the same suite may be repeated across matrix jobs.",
          suggestion:
            "If this matrix is intended for test parallelization, make sure the test runner actually consumes the shard value, for example through jest --shard, Playwright sharding, or an equivalent split mechanism.",
          measurementHint:
            "Compare per-leg test counts and total workflow runtime before and after wiring the matrix value into the test runner.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", confirm whether matrix keys ${shardKeys.join(", ")} are meant for test sharding, and if so pass them into the test runner instead of running the full suite on every matrix leg.`,
          score: 36,
        }),
      );
    }
    return findings;
  },
};
