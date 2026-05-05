import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-nextest-for-heavy-rust-tests",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextest-for-heavy-rust-tests.md",
} satisfies RuleMeta;

function stepRunsCargoTest(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return /\bcargo\s+test\b/i.test(run) && !/\bcargo\s+test\b[^\n]*\s--doc\b/i.test(run);
}

function stepUsesNextest(step: WorkflowStep): boolean {
  const text = `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""}`;
  return /\b(?:cargo\s+nextest|nextest\s+run|cargo-nextest)\b/i.test(text);
}

function cargoTestCommandLooksHeavy(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return /\bcargo\s+test\b[^\n]*(?:--workspace|--all(?:\s|$)|--all-features|--tests|--benches)/i.test(
    run,
  );
}

function cargoTestCommandLooksPackageScoped(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return /\bcargo\s+test\b[^\n]*(?:-p\s+\S+|--package(?:=|\s)\S+|--manifest-path(?:=|\s)\S+)/i.test(
    run,
  );
}

function jobHasServices(job: WorkflowJob): boolean {
  const services = job.raw.services;
  return Boolean(services && typeof services === "object" && !Array.isArray(services));
}

function jobNameLooksIntegrationHeavy(job: WorkflowJob): boolean {
  return /\b(?:integration|e2e|end-to-end|slow|full)\b/i.test(job.id);
}

function getCargoTestStep(job: WorkflowJob): WorkflowStep | undefined {
  return job.steps.find((step) => stepRunsCargoTest(step));
}

function jobLooksHeavyRustTest(
  job: WorkflowJob,
  cargoTestStep: WorkflowStep,
  context: RuleContext,
): boolean {
  const workspaceMemberCount = context.repository.rust.workspaceMemberCount ?? 0;

  return (
    cargoTestCommandLooksHeavy(cargoTestStep) ||
    jobHasMatrix(job) ||
    jobHasServices(job) ||
    jobNameLooksIntegrationHeavy(job) ||
    (context.repository.rust.hasWorkspace &&
      workspaceMemberCount !== 1 &&
      !cargoTestCommandLooksPackageScoped(cargoTestStep))
  );
}

export const preferNextestForHeavyRustTestsRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (!context.repository.rust.hasCargoToml || context.repository.rust.usesNextest) {
      return [];
    }

    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || job.steps.some((step) => stepUsesNextest(step))) {
        continue;
      }

      const cargoTestStep = getCargoTestStep(job);
      if (!cargoTestStep || !jobLooksHeavyRustTest(job, cargoTestStep, context)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, cargoTestStep.runNode ?? cargoTestStep.node, {
          message: `Job "${job.id}" runs a heavy-looking Rust test path with cargo test instead of cargo-nextest.`,
          why: "cargo-nextest can reduce Rust test wall-clock time on larger workspaces and multi-binary test suites by running tests with a CI-oriented execution model. It does not replace doctests, so doctest coverage may need a separate cargo test --doc step.",
          suggestion:
            "Trial cargo-nextest for this Rust test path, for example by installing cargo-nextest and replacing the heavy cargo test command with cargo nextest run while keeping cargo test --doc if doctests matter.",
          measurementHint:
            "Compare cargo test versus cargo nextest run wall-clock time on the same runner, target set, and feature set before changing the default CI path.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}", confirm whether this Rust test path is slow enough to justify nextest, trial cargo nextest run with equivalent feature/workspace flags, and keep a separate cargo test --doc step if doctests are required.`,
          score: 43,
        }),
      );
    }
    return findings;
  },
};
