import type { WorkflowStep } from "../../workflow.ts";
import { shellInvocations } from "./shell-invocations.ts";

/**
 * Mirrors the fallback rule in repository-diagnostics/docker-persistent-cache-targets.ts:
 * only a literal false/absent value routes the action to Depot's persistent builder.
 * Expressions and unknown values are not assumed to be Depot builds.
 */
export function depotUsesPersistentBuilder(step: WorkflowStep): boolean {
  const fallback = step.with?.["buildx-fallback"];
  return fallback === undefined || fallback === false || fallback === "false";
}

/** Literal depot build/bake arguments only; echoed or printed text is not a command. */
export function depotCommandArguments(text: string): string[][] {
  return shellInvocations(text)
    .filter(([tool, action]) => tool === "depot" && ["build", "bake"].includes(action ?? ""))
    .map(([, , ...args]) => args);
}
