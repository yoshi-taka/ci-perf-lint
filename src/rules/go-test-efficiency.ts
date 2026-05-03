import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const redundantVetMeta = {
  id: "go-test-repeats-vet-after-go-vet",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/go-test-repeats-vet-after-go-vet.md",
} satisfies RuleMeta;

const raceAfterBuildMeta = {
  id: "go-build-before-race-test",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/go-build-before-race-test.md",
} satisfies RuleMeta;

const serialBroadTestMeta = {
  id: "go-test-broad-package-serial-p-one",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/go-test-broad-package-serial-p-one.md",
} satisfies RuleMeta;

function runText(step: WorkflowStep): string {
  return step.run ?? "";
}

function stepRunsGoVet(step: WorkflowStep): boolean {
  return /\bgo\s+vet(?:\s|$)/i.test(runText(step));
}

function stepRunsGoTestWithoutVetOff(step: WorkflowStep): boolean {
  const run = runText(step);
  return /\bgo\s+test(?:\s|$)/i.test(run) && !/(?:^|\s)-vet=off(?:\s|$)/i.test(run);
}

function stepRunsBroadGoBuild(step: WorkflowStep): boolean {
  return /\bgo\s+build\b[\s\S]*(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(runText(step));
}

function stepRunsBroadRaceGoTest(step: WorkflowStep): boolean {
  const run = runText(step);
  return (
    /\bgo\s+test(?:\s|$)/i.test(run) &&
    /(?:^|\s)-race(?:\s|$)/i.test(run) &&
    /(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(run)
  );
}

function stepRunsBroadSerialGoTest(step: WorkflowStep): boolean {
  const run = runText(step);
  return (
    /\bgo\s+test(?:\s|$)/i.test(run) &&
    /(?:^|\s)-p(?:=|\s*)1(?:\s|$)/i.test(run) &&
    /(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(run)
  );
}

function firstStepAfter(
  steps: WorkflowStep[],
  startIndex: number,
  predicate: (step: WorkflowStep) => boolean,
): WorkflowStep | undefined {
  return steps.slice(startIndex + 1).find(predicate);
}

function findGoTestRepeatsVet(
  job: WorkflowJob,
): { vetStep: WorkflowStep; testStep: WorkflowStep } | undefined {
  const vetIndex = job.steps.findIndex((step) => stepRunsGoVet(step));
  if (vetIndex === -1) {
    return undefined;
  }

  const vetStep = job.steps[vetIndex];
  const testStep = firstStepAfter(job.steps, vetIndex, stepRunsGoTestWithoutVetOff);
  return vetStep && testStep ? { vetStep, testStep } : undefined;
}

function findRaceTestAfterBuild(
  job: WorkflowJob,
): { buildStep: WorkflowStep; testStep: WorkflowStep } | undefined {
  const buildIndex = job.steps.findIndex((step) => stepRunsBroadGoBuild(step));
  if (buildIndex === -1) {
    return undefined;
  }

  const buildStep = job.steps[buildIndex];
  const testStep = firstStepAfter(job.steps, buildIndex, stepRunsBroadRaceGoTest);
  return buildStep && testStep ? { buildStep, testStep } : undefined;
}

export const goTestRepeatsVetAfterGoVetRule = {
  meta: redundantVetMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (job.usesReusableWorkflow) {
        return [];
      }

      const repeated = findGoTestRepeatsVet(job);
      if (!repeated) {
        return [];
      }

      return [
        buildDiagnostic(
          workflow,
          redundantVetMeta,
          repeated.testStep.runNode ?? repeated.testStep.node,
          {
            message: `Job "${job.id}" runs \`go vet\` and then runs \`go test\` without \`-vet=off\`.`,
            why: "go test runs a vet subset by default. When the job already has a dedicated go vet step, test compilation can spend extra CPU repeating vet work.",
            suggestion:
              "If the dedicated go vet step provides the intended vet coverage, add `-vet=off` to the later go test command.",
            measurementHint:
              "Compare Go test CPU time and wall-clock time before and after adding -vet=off while keeping the separate go vet step.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}; if the explicit \`go vet\` step is authoritative, add \`-vet=off\` to the later \`go test\` command.`,
            score: 67,
          },
        ),
      ];
    });
  },
};

export const goBuildBeforeRaceTestRule = {
  meta: raceAfterBuildMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (job.usesReusableWorkflow) {
        return [];
      }

      const repeated = findRaceTestAfterBuild(job);
      if (!repeated) {
        return [];
      }

      return [
        buildDiagnostic(
          workflow,
          raceAfterBuildMeta,
          repeated.buildStep.runNode ?? repeated.buildStep.node,
          {
            message: `Job "${job.id}" runs broad \`go build ./...\` before broad race-enabled \`go test\`.`,
            why: "Race-enabled tests rebuild with different instrumentation, so a prior broad non-race go build is much less likely to warm the useful build cache for the race test path.",
            suggestion:
              "Avoid using `go build ./...` as a cache warmer before `go test -race ./...`; keep it only if the job needs a separate compile or binary-size check.",
            measurementHint:
              "Compare job runtime with and without the broad go build step before the race-enabled test run.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and remove or narrow the broad \`go build ./...\` before \`go test -race ./...\` unless that build has a separate required output or validation purpose.`,
            score: 65,
          },
        ),
      ];
    });
  },
};

export const goTestBroadPackageSerialPOneRule = {
  meta: serialBroadTestMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (job.usesReusableWorkflow) {
        return [];
      }

      const step = job.steps.find((candidate) => stepRunsBroadSerialGoTest(candidate));
      if (!step) {
        return [];
      }

      return [
        buildDiagnostic(workflow, serialBroadTestMeta, step.runNode ?? step.node, {
          message: `Job "${job.id}" runs broad \`go test ./...\` with \`-p 1\`.`,
          why: "`-p 1` serializes package-level Go test execution. On broad package patterns this can leave runner CPU idle and stretch both compile and test phases.",
          suggestion:
            "Remove `-p 1`, raise it to match the runner's practical CPU capacity, or split only the truly stateful integration packages into a separate serialized test step.",
          measurementHint:
            "Compare Go test wall-clock time and flake rate before and after relaxing -p 1 on the broad package test run.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and avoid \`go test -p 1 ./...\` unless all packages must be serialized. Prefer serializing only the stateful subset.`,
          score: 64,
        }),
      ];
    });
  },
};
