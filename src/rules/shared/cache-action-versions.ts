import { isScalar } from "yaml";
import type { WorkflowStep } from "../../workflow.ts";

/** Moving tags cannot establish whether a patch-level performance fix is missing. */
export function cacheActionVersionIsBelow(
  step: WorkflowStep,
  action: string,
  minimum: readonly [number, number, number],
): boolean {
  if (!step.uses?.toLowerCase().startsWith(`${action.toLowerCase()}@`)) {
    return false;
  }
  const ref = step.uses.slice(action.length + 1);
  const comment = isScalar(step.usesNode) ? step.usesNode.comment?.trim() : undefined;
  const annotation = comment?.replace(/^ratchet:/, "");
  const annotatedRef = annotation?.toLowerCase().startsWith(`${action.toLowerCase()}@`)
    ? annotation.slice(action.length + 1)
    : annotation;
  // A major milestone can classify v5/v5.7; patch milestones still require full versions.
  const pattern =
    minimum[1] === 0 && minimum[2] === 0
      ? /^v(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/
      : minimum[2] === 0
        ? /^v(\d+)\.(\d+)(?:\.(\d+))?$/
        : /^v(\d+)\.(\d+)\.(\d+)$/;
  const version =
    pattern.exec(ref) ?? (/^[a-f\d]{40}$/i.test(ref) ? pattern.exec(annotatedRef ?? "") : null);
  if (!version) {
    return false;
  }
  for (const [index, target] of minimum.entries()) {
    const actual = Number(version[index + 1] ?? 0);
    if (actual !== target) {
      return actual < target;
    }
  }
  return false;
}
