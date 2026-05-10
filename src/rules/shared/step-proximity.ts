import type { WorkflowDocument } from "../../workflow.ts";

export interface StepPosition {
  globalIndex: number;
  jobId: string;
  jobStepIndex: number;
}

export interface JobBoundary {
  beforeGlobalIndex: number;
  leftJobId: string;
  rightJobId: string;
}

interface WorkflowStepSequence {
  positions: StepPosition[];
  boundaries: JobBoundary[];
  stepCount: number;
}

export function buildStepSequence(workflow: WorkflowDocument): WorkflowStepSequence {
  const positions: StepPosition[] = [];
  const boundaries: JobBoundary[] = [];
  let globalIndex = 0;

  for (let jobIdx = 0; jobIdx < workflow.jobs.length; jobIdx++) {
    const job = workflow.jobs[jobIdx]!;

    for (let stepIdx = 0; stepIdx < job.steps.length; stepIdx++) {
      positions.push({
        globalIndex,
        jobId: job.id,
        jobStepIndex: stepIdx,
      });
      globalIndex++;
    }

    if (job.steps.length > 0 && jobIdx < workflow.jobs.length - 1) {
      boundaries.push({
        beforeGlobalIndex: globalIndex - 1,
        leftJobId: job.id,
        rightJobId: workflow.jobs[jobIdx + 1]!.id,
      });
    }
  }

  return { positions, boundaries, stepCount: globalIndex };
}

// ── Proximity kernel functions ────────────────

const DEFAULT_PROXIMITY_WINDOW = 15;
const DEFAULT_BOUNDARY_WINDOW = 8;

const PROXIMITY_WINDOW_HALF_COS_TABLE = buildHalfCosineTable(DEFAULT_PROXIMITY_WINDOW);
const BOUNDARY_HANN_TABLE = buildBoundaryHannTable(DEFAULT_BOUNDARY_WINDOW);

function buildHalfCosineTable(windowSize: number): Float64Array {
  const table = new Float64Array(windowSize + 1);
  for (let i = 0; i <= windowSize; i++) {
    table[i] = 0.5 * (1 + Math.cos((Math.PI * i) / windowSize));
  }
  return table;
}

function buildBoundaryHannTable(windowSize: number): Float64Array {
  const halfWindow = windowSize / 2;
  const table = new Float64Array(windowSize + 1);
  for (let i = 0; i <= windowSize; i++) {
    if (i > halfWindow / 2) {
      table[i] = 1;
    } else {
      table[i] = 0.5 * (1 - Math.cos((4 * Math.PI * i) / windowSize));
    }
  }
  return table;
}

function cosineProximity(n: number, windowSize: number): number {
  if (n < 0 || n > windowSize) {
    return 0;
  }
  if (windowSize === DEFAULT_PROXIMITY_WINDOW) {
    return PROXIMITY_WINDOW_HALF_COS_TABLE[n]!;
  }
  return 0.5 * (1 + Math.cos((Math.PI * n) / windowSize));
}

function crossJobAttenuation(distToBoundary: number, windowSize: number): number {
  if (distToBoundary < 0 || distToBoundary > windowSize / 2) {
    return distToBoundary >= windowSize / 2 ? 1 : 0;
  }
  if (windowSize === DEFAULT_BOUNDARY_WINDOW) {
    return BOUNDARY_HANN_TABLE[distToBoundary]!;
  }
  if (distToBoundary > windowSize / 4) {
    return 1;
  }
  return 0.5 * (1 - Math.cos((4 * Math.PI * distToBoundary) / windowSize));
}

export function computePairProximity(
  pos1: StepPosition,
  pos2: StepPosition,
  boundaries: JobBoundary[],
  proximityWindow = DEFAULT_PROXIMITY_WINDOW,
  boundaryWindow = DEFAULT_BOUNDARY_WINDOW,
): number {
  const distance = Math.abs(pos1.globalIndex - pos2.globalIndex);
  const baseWeight = cosineProximity(distance, proximityWindow);
  if (baseWeight === 0) {
    return 0;
  }

  if (pos1.jobId === pos2.jobId) {
    return baseWeight;
  }

  const minIdx = Math.min(pos1.globalIndex, pos2.globalIndex);
  const maxIdx = Math.max(pos1.globalIndex, pos2.globalIndex);

  for (const boundary of boundaries) {
    if (boundary.beforeGlobalIndex >= minIdx && boundary.beforeGlobalIndex < maxIdx) {
      const leftDist = boundary.beforeGlobalIndex - minIdx + 1;
      const rightDist = maxIdx - boundary.beforeGlobalIndex;
      const minDist = Math.min(leftDist, rightDist);
      const attenuation = crossJobAttenuation(minDist, boundaryWindow);
      return baseWeight * attenuation;
    }
  }

  return baseWeight;
}
