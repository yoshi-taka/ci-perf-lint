import type { WorkflowJob } from "../../workflow.ts";
import {
  getRunsOnSpec,
  jobRunsOnStandardX64Ubuntu,
  jobRunsOnArmLikeRunner,
} from "./runs-on-facts.ts";

export { jobRunsOnStandardX64Ubuntu, jobRunsOnArmLikeRunner };

export function suggestedStandardArmUbuntuRunner(job: WorkflowJob): string {
  const labels = getRunsOnSpec(job).labels;
  return labels.includes("ubuntu-22.04") ? "ubuntu-22.04-arm" : "ubuntu-24.04-arm";
}
