import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { textRunsDockerBuild } from "./shared/docker.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const meta = {
  id: "docker-bake-file-unused-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/docker-bake-file-unused-in-ci.md",
  scope: "both",
} satisfies RuleMeta;

const bakeInvocationPattern = /\bdocker\s+buildx\s+bake\b/i;

function workloadRunsBake(entries: ReturnType<typeof collectCommandEntries>): boolean {
  return entries.some((e) => bakeInvocationPattern.test(e.text));
}

export const dockerBakeFileUnusedInCiRule = {
  meta,
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    context: RuleContext,
  ) {
    if (!context.repository.docker.hasBakeFile) {
      return [];
    }

    const entries = collectCommandEntries(workflow);
    if (workloadRunsBake(entries)) {
      return [];
    }

    const dockerBuildEntry = entries.find((e) => textRunsDockerBuild(e.text));
    if (!dockerBuildEntry) {
      return [];
    }

    return [
      buildDiagnostic(workflow, meta, dockerBuildEntry.node, {
        message: `Repository has a Docker bake file, but ${workflow.relativePath} builds Docker images without invoking \`docker buildx bake\`.`,
        why: "A checked-in bake file usually captures shared Docker build targets, tags, platforms, and dependencies. Bypassing it in CI can duplicate build configuration and miss BuildKit's target graph scheduling.",
        suggestion:
          "Use `docker buildx bake` in CI for Docker image builds that are already represented by the repository bake file.",
        measurementHint:
          "Compare build output, target coverage, and Docker build wall-clock time before and after switching this workload to buildx bake.",
        aiHandoff: `Review ${workflow.relativePath} and switch Docker image builds to the repository's bake file with \`docker buildx bake\` if the existing bake targets cover this workload's images.`,
        score: 70,
      }),
    ];
  },
};
