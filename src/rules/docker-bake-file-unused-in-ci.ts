import type { RuleMeta, Diagnostic } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { textRunsDockerBuild } from "./shared/docker.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";
import { selectSignal } from "./shared/signal-selector.ts";

const hasBakeFile = selectSignal((s) => s.docker.hasBakeFile);

const meta = {
  id: "docker-bake-file-unused-in-ci",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/docker-bake-file-unused-in-ci.md",
  scope: "all",
} satisfies RuleMeta;

const bakeInvocationPattern = /\bdocker\s+buildx\s+bake\b/i;

export const dockerBakeFileUnusedInCiRule = {
  meta,
  check(doc: CIDocument, context: RuleContext): Diagnostic[] {
    if (!hasBakeFile.select(context.repository)) {
      return [];
    }

    const steps = extractSemanticSteps(doc);
    if (steps.some((s) => bakeInvocationPattern.test(s.text))) {
      return [];
    }

    const dockerBuildStep = steps.find((s) => textRunsDockerBuild(s.text));
    if (!dockerBuildStep) {
      return [];
    }

    return [
      buildDiagnostic(doc, meta, dockerBuildStep.node, {
        message: `Repository has a Docker bake file, but ${doc.relativePath} builds Docker images without invoking \`docker buildx bake\`.`,
        why: "A checked-in bake file usually captures shared Docker build targets, tags, platforms, and dependencies. Bypassing it in CI can duplicate build configuration and miss BuildKit's target graph scheduling.",
        suggestion:
          "Use `docker buildx bake` in CI for Docker image builds that are already represented by the repository bake file.",
        measurementHint:
          "Compare build output, target coverage, and Docker build wall-clock time before and after switching this workload to buildx bake.",
        aiHandoff: `Review ${doc.relativePath} and switch Docker image builds to the repository's bake file with \`docker buildx bake\` if the existing bake targets cover this workload's images.`,
        score: 70,
      }),
    ];
  },
};
