import type { WorkflowDocument, WorkflowStep } from "../../workflow.ts";
import { getScalarValue } from "../../workflow.ts";
import { effectiveStepEnvironment } from "./workflow-env.ts";
import { jobRunsOnBlacksmithRunner } from "./runs-on-facts.ts";
import { blacksmithShellPreservesBuilder } from "./blacksmith-docker-shell.ts";
import { stepHasKnownRunnerShell } from "./runner-execution-context.ts";

const builderEnvironment = ["BUILDX_BUILDER", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_BUILDKIT"];

/** Unknown setup or shell execution may select a different builder. Do not guess. */
export function blacksmithDockerBuilds(workflow: WorkflowDocument) {
  const builds: { jobId: string; step: WorkflowStep; persistent: boolean; missing: boolean }[] = [];
  for (const job of workflow.jobs) {
    if (job.usesReusableWorkflow || job.raw.container || !jobRunsOnBlacksmithRunner(job)) {
      continue;
    }
    let state: "missing" | "persistent" | "unknown" = "missing";
    let runnerEnvironmentUnknown = false;
    for (const step of job.steps) {
      const condition = getScalarValue(step.node, "if");
      if (condition === false || condition === "false" || condition === "${{ false }}") {
        continue;
      }
      const uses = step.uses?.toLowerCase() ?? "";
      const environment = effectiveStepEnvironment(workflow, job, step);
      const override = builderEnvironment.some((name) => environment[name] !== undefined);
      const opaqueShell =
        step.run &&
        (!stepHasKnownRunnerShell(workflow, job, step) ||
          !blacksmithShellPreservesBuilder(step.run));
      if (opaqueShell && /\$\{?GITHUB_(?:ENV|PATH)\b/.test(step.run ?? "")) {
        runnerEnvironmentUnknown = true;
      }
      if (uses.startsWith("useblacksmith/setup-docker-builder@")) {
        const key = step.with?.["cache-key"];
        state =
          /^useblacksmith\/setup-docker-builder@v2(?:\.|$)/.test(uses) &&
          typeof key === "string" &&
          key.trim() !== "" &&
          !step.ifNode &&
          !override &&
          !runnerEnvironmentUnknown
            ? "persistent"
            : "unknown";
      } else if (/^(?:docker|useblacksmith)\/build-push-action@/.test(uses)) {
        builds.push({
          jobId: job.id,
          step,
          persistent: state === "persistent" && !override && step.with?.builder === undefined,
          missing:
            state === "missing" &&
            /^useblacksmith\/build-push-action@v2(?:\.|$)/.test(uses) &&
            !override &&
            step.with?.builder === undefined,
        });
      } else if (
        opaqueShell ||
        (uses && !/^(?:actions\/checkout|docker\/(?:login|metadata)-action)@/.test(uses))
      ) {
        state = "unknown";
      }
    }
  }
  return builds;
}
