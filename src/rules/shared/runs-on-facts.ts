import type { WorkflowJob } from "../../workflow.ts";
import type { YAMLMap } from "yaml";
import { getNode, getStringOrArrayValue } from "../../workflow.ts";

export type RunsOnOs = "ubuntu" | "windows" | "macos" | "unknown";
export type RunsOnArch = "x64" | "arm" | "unknown";

export interface RunsOnSpec {
  readonly labels: readonly string[];
  readonly os: RunsOnOs;
  readonly arch: RunsOnArch;
  readonly isStandardHosted: boolean;
  readonly usesContainer: boolean;
  readonly isUbuntu: boolean;
  readonly isWindows: boolean;
  readonly isMacos: boolean;
}

const standardHostedNonUbuntuLabels = new Set([
  "windows-latest",
  "windows-2025",
  "windows-2022",
  "windows-2019",
  "macos-latest",
  "macos-14",
  "macos-15",
  "macos-26",
  "macos-15-intel",
  "macos-26-intel",
]);

const standardUbuntuX64LabelPattern = /^ubuntu-(?:latest|\d{2}\.\d{2})$/;
const standardUbuntuArmLabelPattern = /^ubuntu-\d{2}\.\d{2}-arm$/;

function isStandardUbuntuX64Label(label: string): boolean {
  return standardUbuntuX64LabelPattern.test(label);
}

function isStandardUbuntuLabel(label: string): boolean {
  return isStandardUbuntuX64Label(label) || standardUbuntuArmLabelPattern.test(label);
}

const runsOnSpecCache = new WeakMap<WorkflowJob, RunsOnSpec>();

function isYamlMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return Boolean(node && typeof node === "object" && "items" in (node as Record<string, unknown>));
}

function extractLabels(job: WorkflowJob): string[] {
  if (!isYamlMap(job.node)) {
    const runsOn = job.raw["runs-on"];
    if (typeof runsOn === "string") {
      return [runsOn];
    }
    if (Array.isArray(runsOn)) {
      return runsOn.filter((e): e is string => typeof e === "string");
    }
    return [];
  }
  const runsOn = getStringOrArrayValue(job.node, "runs-on");
  if (typeof runsOn === "string") {
    return [runsOn];
  }
  if (Array.isArray(runsOn)) {
    return runsOn.filter((entry): entry is string => typeof entry === "string");
  }
  return [];
}

function detectOs(labels: readonly string[]): RunsOnOs {
  if (labels.some((l) => /^ubuntu-/i.test(l))) {
    return "ubuntu";
  }
  if (labels.some((l) => /^windows-/i.test(l))) {
    return "windows";
  }
  if (labels.some((l) => /^macos-/i.test(l))) {
    return "macos";
  }
  return "unknown";
}

function detectArch(labels: readonly string[]): RunsOnArch {
  if (labels.some((l) => /\b(arm|arm64|aarch64)\b/i.test(l))) {
    return "arm";
  }
  return "x64";
}

function isStandardHosted(labels: readonly string[]): boolean {
  if (labels.length === 0) {
    return false;
  }
  return labels.every(
    (label) => standardHostedNonUbuntuLabels.has(label) || isStandardUbuntuLabel(label),
  );
}

export function getRunsOnSpec(job: WorkflowJob): RunsOnSpec {
  const cached = runsOnSpecCache.get(job);
  if (cached) {
    return cached;
  }

  const labels = extractLabels(job);
  const loweredLabels = labels.map((l) => l.toLowerCase());
  const os = detectOs(loweredLabels);
  const arch = detectArch(loweredLabels);

  let usesContainer = false;
  if (!isYamlMap(job.node)) {
    usesContainer = Boolean(job.raw.container);
  } else {
    usesContainer = getNode(job.node, "container") !== undefined;
  }

  const spec: RunsOnSpec = {
    labels: loweredLabels,
    os,
    arch,
    isStandardHosted: isStandardHosted(loweredLabels),
    usesContainer,
    isUbuntu: os === "ubuntu",
    isWindows: os === "windows",
    isMacos: os === "macos",
  };

  runsOnSpecCache.set(job, spec);
  return spec;
}

export function jobRunsOnStandardX64Ubuntu(job: WorkflowJob): boolean {
  return getRunsOnSpec(job).labels.some((label) => isStandardUbuntuX64Label(label));
}

export function jobRunsOnArmLikeRunner(job: WorkflowJob): boolean {
  return getRunsOnSpec(job).arch === "arm";
}
