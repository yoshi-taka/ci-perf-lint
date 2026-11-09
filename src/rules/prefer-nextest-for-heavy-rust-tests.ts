import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";

const meta = {
  id: "prefer-nextest-for-heavy-rust-tests",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-nextest-for-heavy-rust-tests.md",
} satisfies RuleMeta;

function cargoTestArguments(step: WorkflowStep): string[][] {
  return shellInvocations(step.run ?? "", false).flatMap(([tool, ...words]) => {
    if (tool !== "cargo") {
      return [];
    }
    if (words[0]?.startsWith("+")) {
      words = words.slice(1);
    }
    if (words[0] !== "test") {
      return [];
    }
    const end = words.indexOf("--");
    const args = words.slice(1, end < 0 ? undefined : end);
    return args.some((arg) => ["--doc", "--help", "-h", "--no-run"].includes(arg)) ? [] : [args];
  });
}

function stepUsesNextest(step: WorkflowStep): boolean {
  return (
    shellInvocations(step.run ?? "", false).some(([tool, ...words]) => {
      if (tool === "cargo" && words[0]?.startsWith("+")) {
        words = words.slice(1);
      }
      if (tool === "cargo" && words[0] === "install") {
        for (let index = 1; index < words.length; index++) {
          const word = words[index]!;
          if (
            [
              "--version",
              "--root",
              "--path",
              "--git",
              "--branch",
              "--tag",
              "--rev",
              "--index",
              "--registry",
              "--target",
              "--target-dir",
              "--features",
              "--jobs",
              "-j",
            ].includes(word)
          ) {
            index++;
          } else if (/^cargo-nextest(?:@.+)?$/.test(word)) {
            return true;
          }
        }
      }
      return (
        (tool === "cargo" && words[0] === "nextest") ||
        (tool === "nextest" && words[0] === "run") ||
        tool === "cargo-nextest"
      );
    }) || /^taiki-e\/install-action@(?:cargo-)?nextest$/.test(step.uses ?? "")
  );
}

function cargoTestCommandLooksHeavy(step: WorkflowStep): boolean {
  return cargoTestArguments(step).some((args) =>
    args.some((arg) =>
      ["--workspace", "--all", "--all-features", "--tests", "--benches"].includes(arg),
    ),
  );
}

function cargoTestCommandLooksPackageScoped(step: WorkflowStep): boolean {
  return cargoTestArguments(step).some((args) =>
    args.some(
      (arg, index) =>
        /^(?:--package|--manifest-path)=.+/.test(arg) ||
        (["-p", "--package", "--manifest-path"].includes(arg) && Boolean(args[index + 1])),
    ),
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
  return job.steps.find((step) => cargoTestArguments(step).length > 0);
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
