import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { traceCommandReferences } from "./shared/command-reference-tracing.ts";
import { jobIsFullyOverridden } from "./shared/circleci-effective-steps.ts";
import { collectCircleCiWorkflowInvocations } from "../circleci-workflow-graph.ts";

const meta = {
  id: "circleci-parallelism-without-test-splitting",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/circleci-parallelism-without-test-splitting.md",
  scope: "circleci",
} satisfies RuleMeta;

const SPLIT_SIGNAL =
  /circleci\s+tests\s+(?:split|run|glob)|circleci\s+testsuite|CIRCLE_NODE_(?:INDEX|TOTAL)/i;

const BUILTIN_STEPS = new Set([
  "checkout",
  "run",
  "save_cache",
  "restore_cache",
  "setup_remote_docker",
  "persist_to_workspace",
  "attach_workspace",
  "add_ssh_keys",
]);

function isBuiltinStep(type: string): boolean {
  return BUILTIN_STEPS.has(type) || type.startsWith("store_");
}

function repeatedWorkDetail(text: string): string {
  if (/\bdocker\s+(?:build|buildx\s+build|push)\b/i.test(text)) {
    return "Parallelism gives no benefit here: each node performs an identical build or push.";
  }
  if (/\b(?:isort|black|mypy|ruff|flake8|eslint|prettier|biome|oxlint)\b/i.test(text)) {
    return "Parallelism gives no benefit here: the same lint checks run on every node.";
  }
  return "Splitting requires a test splitter; without one every node repeats the full suite.";
}

export const circleciParallelismWithoutTestSplittingRule = {
  meta,
  async check(doc: CircleCiDocument, context: RuleContext) {
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    for (const job of doc.jobs) {
      if (typeof job.parallelism !== "number" || job.parallelism < 2) {
        continue;
      }
      if (jobIsFullyOverridden(doc, job.name)) {
        continue;
      }
      const nodes = job.parallelism;
      const visibleText = job.steps.map((step) => `${step.type} ${step.command ?? ""}`).join("\n");
      if (SPLIT_SIGNAL.test(visibleText)) {
        continue;
      }

      let lowConfidence = false;
      let tracedText = visibleText;
      for (const step of job.steps) {
        if (step.orbUnresolved || (step.type.includes("/") && !isBuiltinStep(step.type))) {
          lowConfidence = true;
        }
        if (step.type !== "run") {
          continue;
        }
        const trace = await traceCommandReferences(step.command ?? "", context.scanContext);
        tracedText += `\n${trace.text}`;
        if (trace.delegates || trace.unresolved) {
          lowConfidence = true;
        }
      }
      if (SPLIT_SIGNAL.test(tracedText)) {
        continue;
      }
      if (!lowConfidence && job.steps.some((step) => !isBuiltinStep(step.type))) {
        lowConfidence = true;
      }

      const resource = job.resourceClass ? ` on ${job.resourceClass}` : "";
      const label =
        collectCircleCiWorkflowInvocations(doc).find(
          (invocation) => invocation.jobName === job.name && !invocation.overrideWith,
        )?.alias ?? job.name;
      findings.push(
        buildDiagnostic(doc, meta, job.parallelismNode ?? job.node, {
          severity: lowConfidence ? "suggestion" : undefined,
          confidence: lowConfidence ? "low" : undefined,
          message: `Job "${label}" uses parallelism: ${nodes}${resource}. Each of the ${nodes} nodes repeats the same work.`,
          why: `CircleCI starts ${nodes} identical nodes for this job. ${repeatedWorkDetail(tracedText)} Without a split signal in the step text, the nodes cannot divide the work and the runner cost multiplies by ${nodes}.`,
          suggestion:
            "Remove parallelism for this job, or split the work with `circleci tests run` / `circleci testsuite` so each node handles a distinct shard.",
          measurementHint:
            "Compare total runner minutes and wall-clock time before and after removing or sharding parallelism.",
          aiHandoff: `Review job "${job.name}" in ${doc.relativePath}. If the steps do not already divide work with a CircleCI test splitter, remove parallelism or add sharding; verify the checks still cover the same files.`,
          score: lowConfidence ? 50 : 64,
        }),
      );
    }

    return findings;
  },
};
