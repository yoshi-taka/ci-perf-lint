import type { WorkflowJob, WorkflowStep } from "../../workflow.ts";

function stepRunsGoVet(step: WorkflowStep): boolean {
  return /\bgo\s+vet(?:\s|$)/i.test(step.run ?? "");
}

function stepRunsGoTest(step: WorkflowStep): boolean {
  return /\bgo\s+test(?:\s|$)/i.test(step.run ?? "");
}

function stepRunsGoTestWithoutVetOff(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return /\bgo\s+test(?:\s|$)/i.test(run) && !/(?:^|\s)-vet=off(?:\s|$)/i.test(run);
}

function stepRunsBroadGoBuild(step: WorkflowStep): boolean {
  return /\bgo\s+build\b[\s\S]*(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(step.run ?? "");
}

function stepRunsBroadRaceGoTest(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return (
    /\bgo\s+test(?:\s|$)/i.test(run) &&
    /(?:^|\s)-race(?:\s|$)/i.test(run) &&
    /(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(run)
  );
}

function stepRunsBroadSerialGoTest(step: WorkflowStep): boolean {
  const run = step.run ?? "";
  return (
    /\bgo\s+test(?:\s|$)/i.test(run) &&
    /(?:^|\s)-p(?:=|\s*)1(?:\s|$)/i.test(run) &&
    /(?:^|\s)\.\/\.\.\.(?:\s|$)/i.test(run)
  );
}

export function goBuildOccurrenceCountInRun(run: string): number {
  return run.match(/\bgo\s+build(?:\s|$)/gi)?.length ?? 0;
}

export interface JobStepAnalysis {
  readonly stepCount: number;
  readonly goVetStepIndex: number;
  readonly firstGoTestAfterVetIndex: number;
  readonly broadGoBuildStepIndex: number;
  readonly firstRaceGoTestAfterBuildIndex: number;
  readonly hasBroadSerialGoTest: boolean;
  readonly broadSerialGoTestStepIndex: number;
  readonly goBuildOccurrenceTotal: number;
  readonly isGoVetStep: readonly boolean[];
  readonly isGoTestStep: readonly boolean[];
  readonly isGoBuildStep: readonly boolean[];
}

const analysisCache = new WeakMap<WorkflowJob, JobStepAnalysis>();

export function getJobStepAnalysis(job: WorkflowJob): JobStepAnalysis {
  const cached = analysisCache.get(job);
  if (cached) {
    return cached;
  }
  const analysis = buildJobStepAnalysis(job);
  analysisCache.set(job, analysis);
  return analysis;
}

function buildJobStepAnalysis(job: WorkflowJob): JobStepAnalysis {
  const steps = job.steps;
  const count = steps.length;

  const isGoVetStep = new Array<boolean>(count);
  const isGoTestStep = new Array<boolean>(count);
  const isGoBuildStep = new Array<boolean>(count);

  let goVetStepIndex = -1;
  let firstGoTestAfterVetIndex = -1;
  let broadGoBuildStepIndex = -1;
  let firstRaceGoTestAfterBuildIndex = -1;
  let hasBroadSerialGoTest = false;
  let broadSerialGoTestStepIndex = -1;
  let goBuildOccurrenceTotal = 0;

  for (let i = 0; i < count; i++) {
    const step = steps[i]!;
    const run = step.run ?? "";

    const vet = /\bgo\s+vet(?:\s|$)/i.test(run);
    isGoVetStep[i] = vet;
    if (vet && goVetStepIndex === -1) {
      goVetStepIndex = i;
    }

    const test = /\bgo\s+test(?:\s|$)/i.test(run);
    isGoTestStep[i] = test;

    const build = /\bgo\s+build(?:\s|$)/i.test(run);
    isGoBuildStep[i] = build;

    goBuildOccurrenceTotal += goBuildOccurrenceCountInRun(run);

    if (build && stepRunsBroadGoBuild(step) && broadGoBuildStepIndex === -1) {
      broadGoBuildStepIndex = i;
    }
  }

  if (goVetStepIndex !== -1) {
    for (let i = goVetStepIndex + 1; i < count; i++) {
      if (stepRunsGoTestWithoutVetOff(steps[i]!)) {
        firstGoTestAfterVetIndex = i;
        break;
      }
    }
  }

  if (broadGoBuildStepIndex !== -1) {
    for (let i = broadGoBuildStepIndex + 1; i < count; i++) {
      if (stepRunsBroadRaceGoTest(steps[i]!)) {
        firstRaceGoTestAfterBuildIndex = i;
        break;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (stepRunsBroadSerialGoTest(steps[i]!)) {
      hasBroadSerialGoTest = true;
      broadSerialGoTestStepIndex = i;
      break;
    }
  }

  return {
    stepCount: count,
    goVetStepIndex,
    firstGoTestAfterVetIndex,
    broadGoBuildStepIndex,
    firstRaceGoTestAfterBuildIndex,
    hasBroadSerialGoTest,
    broadSerialGoTestStepIndex,
    goBuildOccurrenceTotal,
    isGoVetStep,
    isGoTestStep,
    isGoBuildStep,
  };
}
