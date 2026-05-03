import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "missing-gradle-build-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-gradle-build-cache.md",
} satisfies RuleMeta;

function jobRunsGradleTasks(job: WorkflowJob): boolean {
  return job.steps.some(
    (step) =>
      step.run !== undefined &&
      /(?:\.\/gradlew\b|gradle\b).*?\b(?:build|test|assemble|check)\b/i.test(step.run),
  );
}

export const missingGradleBuildCacheRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesGradle ||
      context.repository.frameworks.gradleBuildCacheConfigured
    ) {
      return [];
    }

    return workflow.jobs
      .filter((job) => jobRunsGradleTasks(job))
      .map((job) =>
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs Gradle tasks without visible build cache configuration in the repository.`,
          why: "Gradle build cache can reuse task outputs across builds, but no visible `buildCache` configuration was found in `settings.gradle` or `settings.gradle.kts`.",
          suggestion:
            "If this repository repeats the same Gradle tasks in CI, configure Gradle build cache in the repository and keep it only if total job time improves.",
          measurementHint:
            "Compare Gradle task duration, reported build-cache hits, and total job time before and after enabling Gradle build cache.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" together with the repository's Gradle settings. If this CI path repeats the same Gradle tasks, test repository-level build cache configuration and keep it only when total time improves.`,
          score: 51,
        }),
      );
  },
};
