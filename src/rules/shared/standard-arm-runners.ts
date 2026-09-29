import type { WorkflowJob } from "../../workflow.ts";
import {
  getRunsOnSpec,
  jobRunsOnStandardX64Ubuntu,
  jobRunsOnArmLikeRunner,
} from "./runs-on-facts.ts";

export { jobRunsOnStandardX64Ubuntu, jobRunsOnArmLikeRunner };

const latestUbuntuArmLabel = "ubuntu-24.04-arm";
const minimumUbuntuArmMajor = 22;
const minimumUbuntuArmMinor = 4;

export function suggestedStandardArmUbuntuRunner(job: WorkflowJob): string {
  for (const label of getRunsOnSpec(job).labels) {
    const match = /^ubuntu-(\d{2})\.(\d{2})$/.exec(label);
    if (!match) {
      continue;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (
      major > minimumUbuntuArmMajor ||
      (major === minimumUbuntuArmMajor && minor >= minimumUbuntuArmMinor)
    ) {
      return `${label}-arm`;
    }
    return latestUbuntuArmLabel;
  }
  return latestUbuntuArmLabel;
}
