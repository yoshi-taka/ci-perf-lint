import type { WorkflowJob } from "../../workflow.ts";
import {
  getRunsOnSpec,
  jobRunsOnStandardX64Ubuntu,
  jobRunsOnArmLikeRunner,
} from "./runs-on-facts.ts";

export { jobRunsOnStandardX64Ubuntu, jobRunsOnArmLikeRunner };

export function suggestedStandardArmUbuntuRunner(job: WorkflowJob): string | undefined {
  for (const label of getRunsOnSpec(job).labels) {
    if (/^ubuntu-\d{2}\.\d{2}$/.test(label)) {
      return `${label}-arm`;
    }
  }
  return undefined;
}
