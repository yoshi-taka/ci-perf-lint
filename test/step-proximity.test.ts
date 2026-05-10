import { describe, expect, test } from "bun:test";
import { buildStepSequence, computePairProximity } from "../src/rules/shared/step-proximity.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../src/workflow.ts";

function makeStep(name?: string, run?: string): WorkflowStep {
  return {
    name,
    run,
    uses: undefined,
    node: undefined as never,
    runNode: undefined as never,
  } as unknown as WorkflowStep;
}

function makeJob(id: string, stepCount: number): WorkflowJob {
  return {
    id,
    steps: Array.from({ length: stepCount }, (_, i) => makeStep(`step${i}`, `echo ${i}`)),
  } as unknown as WorkflowJob;
}

describe("buildStepSequence", () => {
  test("single job, single step", () => {
    const wf = { jobs: [makeJob("build", 1)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    expect(seq.positions).toHaveLength(1);
    expect(seq.positions[0]!.globalIndex).toBe(0);
    expect(seq.positions[0]!.jobId).toBe("build");
    expect(seq.boundaries).toHaveLength(0);
  });

  test("two jobs with steps creates boundary", () => {
    const wf = { jobs: [makeJob("lint", 3), makeJob("build", 2)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    expect(seq.positions).toHaveLength(5);
    expect(seq.boundaries).toHaveLength(1);
    expect(seq.boundaries[0]!.beforeGlobalIndex).toBe(2);
    expect(seq.boundaries[0]!.leftJobId).toBe("lint");
    expect(seq.boundaries[0]!.rightJobId).toBe("build");
  });

  test("three jobs creates two boundaries", () => {
    const wf = {
      jobs: [makeJob("a", 1), makeJob("b", 1), makeJob("c", 1)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    expect(seq.boundaries).toHaveLength(2);
  });

  test("skip boundary for empty job", () => {
    const wf = { jobs: [makeJob("a", 0), makeJob("b", 1)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    expect(seq.boundaries).toHaveLength(0);
  });
});

describe("cosineProximity semantics", () => {
  test("same position → proximity = 1", () => {
    const wf = { jobs: [makeJob("test", 5)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[0]!, seq.boundaries);
    expect(prox).toBe(1);
  });

  test("adjacent steps (distance=1) → high proximity", () => {
    const wf = { jobs: [makeJob("test", 5)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[1]!, seq.boundaries);
    expect(prox).toBeCloseTo(0.5 * (1 + Math.cos(Math.PI / 15)), 10);
  });

  test("distance == proximityWindow → proximity = 0", () => {
    const wf = { jobs: [makeJob("test", 20)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[15]!, seq.boundaries);
    // hannProximity(15, 15) = 0.5 * (1 + cos(π)) = 0
    expect(prox).toBe(0);
  });

  test("distance > proximityWindow → proximity = 0", () => {
    const wf = { jobs: [makeJob("test", 30)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[20]!, seq.boundaries);
    expect(prox).toBe(0);
  });

  test("monotonically decreasing with distance", () => {
    const wf = { jobs: [makeJob("test", 30)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const ref = seq.positions[0]!;
    let prev = 1;
    for (let d = 1; d <= 10; d++) {
      const prox = computePairProximity(ref, seq.positions[d]!, seq.boundaries);
      expect(prox).toBeLessThanOrEqual(prev);
      expect(prox).toBeGreaterThan(0);
      prev = prox;
    }
  });
});

describe("cross-job attenuation", () => {
  test("steps across boundary with small minDist → attenuated", () => {
    const wf = {
      jobs: [makeJob("lint", 3), makeJob("build", 3)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const leftLast = seq.positions[2]!;
    const rightFirst = seq.positions[3]!;
    const prox = computePairProximity(leftLast, rightFirst, seq.boundaries);
    // adjacent across boundary: leftDist=1, rightDist=1, minDist=1
    // attenuation = hannWindow(1, 16) = 0.5 * (1 - cos(π/8))
    const expectedAtten = 0.5 * (1 - Math.cos(Math.PI / 2));
    const expectedBase = 0.5 * (1 + Math.cos(Math.PI / 15));
    expect(prox).toBeCloseTo(expectedBase * expectedAtten, 10);
  });

  test("steps across boundary far from boundary → less attenuated (factor closer to 1)", () => {
    const wf = {
      // lint has steps 0,1,2; build has steps 3,4,5
      jobs: [makeJob("lint", 3), makeJob("build", 3)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    // step 0 (left job) and step 5 (right job): both far from boundary
    const leftFirst = seq.positions[0]!;
    const rightLast = seq.positions[5]!;
    const prox = computePairProximity(leftFirst, rightLast, seq.boundaries);
    // leftDist = 2 - 0 + 1 = 3, rightDist = 5 - 2 = 3, minDist = 3
    // 3 > boundaryWindow/4 (2) → attenuation = 1
    const expectedAtten = 1;
    const expectedBase = 0.5 * (1 + Math.cos((5 * Math.PI) / 15));
    expect(prox).toBeCloseTo(expectedBase * expectedAtten, 10);
  });

  test("minDist >= boundaryWindow → no attenuation (factor = 1)", () => {
    const wf = {
      // lint 8 steps, build 8 steps
      jobs: [makeJob("lint", 8), makeJob("build", 8)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    // Step 0 and step 15: minDist = min(8, 8) = 8 >= boundaryWindow(8)
    const leftFirst = seq.positions[0]!;
    const rightLast = seq.positions[15]!;
    const prox = computePairProximity(leftFirst, rightLast, seq.boundaries);
    const expectedBase = 0.5 * (1 + Math.cos((15 * Math.PI) / 15));
    expect(prox).toBeCloseTo(expectedBase, 10);
  });

  test("same job → no attenuation (full base weight)", () => {
    const wf = {
      jobs: [makeJob("lint", 5), makeJob("build", 5)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[4]!, seq.boundaries);
    const expectedBase = 0.5 * (1 + Math.cos((4 * Math.PI) / 15));
    expect(prox).toBeCloseTo(expectedBase, 10);
  });
});

describe("boundary conditions", () => {
  test("globalIndex diff of 0 is 1 (same step)", () => {
    const wf = { jobs: [makeJob("a", 1)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    expect(computePairProximity(seq.positions[0]!, seq.positions[0]!, seq.boundaries)).toBe(1);
  });

  test("distance exactly equals window size returns 0", () => {
    const wf = { jobs: [makeJob("a", 20)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const p0 = seq.positions[0]!;
    const p15 = seq.positions[15]!;
    expect(computePairProximity(p0, p15, seq.boundaries)).toBe(0);
  });

  test("boundary at edge of proximity window", () => {
    const wf = {
      jobs: [makeJob("a", 8), makeJob("b", 8)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const p0 = seq.positions[0]!;
    const p15 = seq.positions[15]!;
    // distance = 15, proximity = 0 → fast return 0 before checking boundaries
    expect(computePairProximity(p0, p15, seq.boundaries)).toBe(0);
  });

  test("no boundaries (single job) returns base weight", () => {
    const wf = { jobs: [makeJob("a", 5)] } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[2]!, seq.boundaries);
    expect(prox).toBeCloseTo(0.5 * (1 + Math.cos((2 * Math.PI) / 15)), 10);
  });

  test("no crossing boundary returns base weight (both in same job)", () => {
    const wf = {
      jobs: [makeJob("a", 3), makeJob("b", 3)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    const prox = computePairProximity(seq.positions[0]!, seq.positions[1]!, seq.boundaries);
    expect(prox).toBeGreaterThan(0);
  });
});

describe("proximity is symmetric", () => {
  test("computePairProximity(a, b) === computePairProximity(b, a)", () => {
    const wf = {
      jobs: [makeJob("lint", 4), makeJob("build", 4)],
    } as WorkflowDocument;
    const seq = buildStepSequence(wf);
    for (let i = 0; i < seq.positions.length; i++) {
      for (let j = i + 1; j < seq.positions.length; j++) {
        const p1 = computePairProximity(seq.positions[i]!, seq.positions[j]!, seq.boundaries);
        const p2 = computePairProximity(seq.positions[j]!, seq.positions[i]!, seq.boundaries);
        expect(p1).toBe(p2);
      }
    }
  });
});
