import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectGradleCommands } from "./shared/gradle-commands.ts";
import { shellExecutionTexts } from "./shared/shell-execution-text.ts";
import { collectCommandEntries, type CIDocument } from "./shared/any-step.ts";

const meta = {
  id: "missing-gradle-build-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-gradle-build-cache.md",
  scope: "all",
} satisfies RuleMeta;

function entryRunsGradleLifecycle(text: string, workingDirectory: string | undefined): boolean {
  return shellExecutionTexts(text).some((source) =>
    collectGradleCommands(source, {}, workingDirectory).some(
      (command) =>
        command.lifecycle &&
        command.tasks.some((task) => /^(?:build|test|assemble|check)(?:[A-Z]\w*)?$/.test(task)),
    ),
  );
}

export const missingGradleBuildCacheRule = {
  meta,
  check(doc: CIDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesGradle ||
      context.repository.frameworks.gradleBuildCacheConfigured
    ) {
      return [];
    }

    const jobs = new Map<string, Parameters<typeof buildDiagnostic>[2]>();
    for (const entry of collectCommandEntries(doc)) {
      if (jobs.has(entry.jobName)) {
        continue;
      }
      if (entryRunsGradleLifecycle(entry.text, entry.workingDirectory)) {
        jobs.set(entry.jobName, entry.node);
      }
    }

    return [...jobs].map(([jobName, node]) =>
      buildDiagnostic(doc, meta, node, {
        message: `Job "${jobName}" runs Gradle tasks without visible build cache configuration in the repository.`,
        why: "Gradle build cache can reuse task outputs across builds, but no visible `buildCache` configuration was found in `settings.gradle` or `settings.gradle.kts`.",
        suggestion:
          "If this repository repeats the same Gradle tasks in CI, configure Gradle build cache in the repository and keep it only if total job time improves.",
        measurementHint:
          "Compare Gradle task duration, reported build-cache hits, and total job time before and after enabling Gradle build cache.",
        aiHandoff: `Review ${doc.relativePath} job "${jobName}" together with the repository's Gradle settings. If this CI path repeats the same Gradle tasks, test repository-level build cache configuration and keep it only when total time improves.`,
        score: 51,
      }),
    );
  },
};
