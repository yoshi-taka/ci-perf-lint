import type { WorkflowDocument } from "../../workflow.ts";

// ──────────────────────────────────────────────
// 1. TYPES — step position with job metadata
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// 2. SEQUENCE BUILDER — build positions + boundaries
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// 3. HANN PROXIMITY — base semantic proximity
// ──────────────────────────────────────────────

const DEFAULT_PROXIMITY_WINDOW = 15;
const DEFAULT_BOUNDARY_WINDOW = 8;

function hannWindow(n: number, windowSize: number): number {
  if (n < 0 || n > windowSize) {
    return 0;
  }
  return 0.5 * (1 - Math.cos((2 * Math.PI * n) / windowSize));
}

function hannProximity(n: number, windowSize: number): number {
  if (n < 0 || n > windowSize) {
    return 0;
  }
  return 0.5 * (1 + Math.cos((Math.PI * n) / windowSize));
}

// ──────────────────────────────────────────────
// 4. CROSS-JOB ATTENUATION — soft boundary model
// ──────────────────────────────────────────────

function crossJobAttenuation(distToBoundary: number, windowSize: number): number {
  if (distToBoundary >= windowSize / 2) {
    return 1;
  }
  return hannWindow(distToBoundary, windowSize / 2);
}

// ──────────────────────────────────────────────
// 5. PAIRWISE PROXIMITY — main computation
// ──────────────────────────────────────────────

export function computePairProximity(
  pos1: StepPosition,
  pos2: StepPosition,
  boundaries: JobBoundary[],
  proximityWindow = DEFAULT_PROXIMITY_WINDOW,
  boundaryWindow = DEFAULT_BOUNDARY_WINDOW,
): number {
  const distance = Math.abs(pos1.globalIndex - pos2.globalIndex);
  const baseWeight = hannProximity(distance, proximityWindow);
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
