import type { WorkflowJob } from "../../workflow.ts";

function getRunsOnLabels(job: WorkflowJob): string[] {
  const runsOn = job.raw["runs-on"];
  if (typeof runsOn === "string") {
    return [runsOn];
  }

  if (Array.isArray(runsOn)) {
    return runsOn.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

export function jobRunsOnStandardX64Ubuntu(job: WorkflowJob): boolean {
  const labels = getRunsOnLabels(job).map((label) => label.toLowerCase());
  return labels.some((label) => /^(ubuntu-latest|ubuntu-24\.04|ubuntu-22\.04)$/.test(label));
}

export function jobRunsOnArmLikeRunner(job: WorkflowJob): boolean {
  return getRunsOnLabels(job).some((label) => /\b(?:arm|arm64|aarch64)\b/i.test(label));
}

export function suggestedStandardArmUbuntuRunner(job: WorkflowJob): string {
  const labels = getRunsOnLabels(job).map((label) => label.toLowerCase());
  return labels.includes("ubuntu-22.04") ? "ubuntu-22.04-arm" : "ubuntu-24.04-arm";
}
