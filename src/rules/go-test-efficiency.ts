import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getJobStepAnalysis } from "./shared/job-step-analysis.ts";

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

export const goTestRepeatsVetAfterGoVetRule = {
  meta: redundantVetMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const analysis = getJobStepAnalysis(job);
      if (analysis.goVetStepIndex === -1 || analysis.firstGoTestAfterVetIndex === -1) {
        continue;
      }

      const testStep = job.steps[analysis.firstGoTestAfterVetIndex]!;
      findings.push(
        buildDiagnostic(workflow, redundantVetMeta, testStep.runNode ?? testStep.node, {
          message: `Job "${job.id}" runs \`go vet\` and then runs \`go test\` without \`-vet=off\`.`,
          why: "go test runs a vet subset by default. When the job already has a dedicated go vet step, test compilation can spend extra CPU repeating vet work.",
          suggestion:
            "If the dedicated go vet step provides the intended vet coverage, add `-vet=off` to the later go test command.",
          measurementHint:
            "Compare Go test CPU time and wall-clock time before and after adding -vet=off while keeping the separate go vet step.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}; if the explicit \`go vet\` step is authoritative, add \`-vet=off\` to the later \`go test\` command.`,
          score: 67,
        }),
      );
    }
    return findings;
  },
};

export const goBuildBeforeRaceTestRule = {
  meta: raceAfterBuildMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const analysis = getJobStepAnalysis(job);
      if (analysis.broadGoBuildStepIndex === -1 || analysis.firstRaceGoTestAfterBuildIndex === -1) {
        continue;
      }

      const buildStep = job.steps[analysis.broadGoBuildStepIndex]!;
      findings.push(
        buildDiagnostic(workflow, raceAfterBuildMeta, buildStep.runNode ?? buildStep.node, {
          message: `Job "${job.id}" runs broad \`go build ./...\` before broad race-enabled \`go test\`.`,
          why: "Race-enabled tests rebuild with different instrumentation, so a prior broad non-race go build is much less likely to warm the useful build cache for the race test path.",
          suggestion:
            "Avoid using `go build ./...` as a cache warmer before `go test -race ./...`; keep it only if the job needs a separate compile or binary-size check.",
          measurementHint:
            "Compare job runtime with and without the broad go build step before the race-enabled test run.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and remove or narrow the broad \`go build ./...\` before \`go test -race ./...\` unless that build has a separate required output or validation purpose.`,
          score: 65,
        }),
      );
    }
    return findings;
  },
};

export const goTestBroadPackageSerialPOneRule = {
  meta: serialBroadTestMeta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const analysis = getJobStepAnalysis(job);
      if (analysis.broadSerialGoTestStepIndex === -1) {
        continue;
      }

      const step = job.steps[analysis.broadSerialGoTestStepIndex]!;

      findings.push(
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
      );
    }
    return findings;
  },
};
