import { Bench } from "tinybench";
import {
  buildStepSequence,
  computePairProximity,
} from "../src/rules/shared/step-proximity.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../src/workflow.ts";

function makeStep(name?: string, run?: string): WorkflowStep {
  return { name, run, uses: undefined, node: undefined as never, runNode: undefined as never } as unknown as WorkflowStep;
}

function makeJob(id: string, stepCount: number): WorkflowJob {
  return {
    id,
    steps: Array.from({ length: stepCount }, (_, i) => makeStep(`step${i}`, `echo ${i}`)),
  } as unknown as WorkflowJob;
}

function makeWorkflow(jobCount: number, stepsPerJob: number): WorkflowDocument {
  return {
    jobs: Array.from({ length: jobCount }, (_, i) => makeJob(`job${i}`, stepsPerJob)),
  } as unknown as WorkflowDocument;
}

function allPairs(seq: ReturnType<typeof buildStepSequence>): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < seq.positions.length; i++) {
    for (let j = i + 1; j < seq.positions.length; j++) {
      pairs.push([i, j]);
    }
  }
  return pairs;
}

const wf = makeWorkflow(4, 8);
const seq = buildStepSequence(wf);
const pairs = allPairs(seq);

const bench = new Bench({ iterations: 50, time: 0, warmup: false });

bench
  .add("computePairProximity > 4×8 steps, all pairs (496 pairs)", () => {
    let sum = 0;
    for (const [i, j] of pairs) {
      sum += computePairProximity(seq.positions[i]!, seq.positions[j]!, seq.boundaries);
    }
    return sum;
  })
  .add("computePairProximity > same job pairs only", () => {
    let sum = 0;
    const pos = seq.positions;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        if (pos[i]!.jobId === pos[j]!.jobId) {
          sum += computePairProximity(pos[i]!, pos[j]!, seq.boundaries);
        }
      }
    }
    return sum;
  })
  .add("computePairProximity > cross-job pairs only", () => {
    let sum = 0;
    const pos = seq.positions;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        if (pos[i]!.jobId !== pos[j]!.jobId) {
          sum += computePairProximity(pos[i]!, pos[j]!, seq.boundaries);
        }
      }
    }
    return sum;
  });

export { bench };
