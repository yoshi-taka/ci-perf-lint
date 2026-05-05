import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "docker-build-load-true-unnecessary",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/docker-build-load-true-unnecessary.md",
} satisfies RuleMeta;

function stepHasLoadTrue(step: WorkflowStep): boolean {
  const uses = step.uses?.toLowerCase() ?? "";
  if (!uses.startsWith("docker/build-push-action@")) {
    return false;
  }
  const load = step.with?.load;
  return load === true || (typeof load === "string" && load.trim().toLowerCase() === "true");
}

function getStaticTagsOrSkip(step: WorkflowStep): string[] | undefined {
  const tags = step.with?.tags;
  if (typeof tags !== "string" || tags.includes("${{")) {
    return undefined;
  }
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function imageUsedAfterStep(job: WorkflowJob, stepIndex: number, tags: string[]): boolean {
  return job.steps.slice(stepIndex + 1).some((step) => {
    const runText = step.run ?? "";
    if (runText.length === 0) {
      return false;
    }

    if (/\bdocker\s+(?:run|compose|tag|save)\b/i.test(runText)) {
      return true;
    }

    if (/\$\{\{\s*steps\.[^}]+\.outputs\.(?:imageid|digest)\s*\}\}/i.test(runText)) {
      return true;
    }

    for (const tag of tags) {
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(escaped).test(runText)) {
        return true;
      }
    }

    return false;
  });
}

export const dockerBuildLoadTrueUnnecessaryRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      for (const [index, step] of job.steps.entries()) {
        if (!stepHasLoadTrue(step)) {
          continue;
        }

        const tags = getStaticTagsOrSkip(step);
        if (tags === undefined) {
          continue;
        }

        if (imageUsedAfterStep(job, index, tags)) {
          continue;
        }

        const tagsHint = tags.length > 0 ? `tags: ${tags.join(", ")}` : "no tags set";

        findings.push(
          buildDiagnostic(workflow, meta, step.withNode ?? step.usesNode ?? step.node, {
            message: `Job "${job.id}" sets load: true on docker/build-push-action (${tagsHint}) but the image is not used by any subsequent step.`,
            why: "`load: true` serializes the built image into the Docker daemon, adding overhead. If no later step runs the image via `docker run`, `docker compose`, `docker tag`, or `docker save`, the load step is unnecessary.",
            suggestion:
              "Remove `load: true` from the docker/build-push-action step unless a subsequent step in the same job needs the image in the local Docker daemon.",
            measurementHint:
              "Compare Docker build wall-clock time before and after removing `load: true`. The savings grow with image size.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} and remove \`load: true\` from the docker/build-push-action step since the loaded image is not used afterward.`,
            score: 50,
          }),
        );
        break;
      }
    }
    return findings;
  },
};
