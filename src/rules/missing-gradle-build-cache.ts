import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectGradleCommands } from "./shared/gradle-commands.ts";
import { shellExecutionTexts } from "./shared/shell-execution-text.ts";
import { collectCommandEntries, type CIDocument } from "./shared/any-step.ts";
import { collectCircleCiGradleOrbInvocations } from "../circleci-gradle-evidence.ts";

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

async function hasGradleBuildFile(context: RuleContext): Promise<boolean> {
  const scanContext = context.scanContext;
  if (!scanContext) {
    return true;
  }
  const candidates = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"];
  const matches = await Promise.all(
    candidates.map((fileName) => scanContext.pathExists(scanContext.resolve(fileName))),
  );
  return matches.some(Boolean);
}

export const missingGradleBuildCacheRule = {
  meta,
  async check(doc: CIDocument, context: RuleContext) {
    if (
      !context.repository.frameworks.usesGradle ||
      context.repository.frameworks.gradleBuildCacheConfigured
    ) {
      return [];
    }

    const jobs = new Map<string, Parameters<typeof buildDiagnostic>[2]>();
    const inferredJobs = new Set<string>();
    for (const entry of collectCommandEntries(doc)) {
      if (jobs.has(entry.jobName)) {
        continue;
      }
      if (entryRunsGradleLifecycle(entry.text, entry.workingDirectory)) {
        jobs.set(entry.jobName, entry.node);
      }
    }
    if (jobs.size === 0 && doc.kind === "circleci" && (await hasGradleBuildFile(context))) {
      for (const invocation of collectCircleCiGradleOrbInvocations(doc)) {
        inferredJobs.add(invocation.jobName);
        jobs.set(invocation.jobName, invocation.node);
      }
    }

    return [...jobs].map(([jobName, node]) =>
      buildDiagnostic(doc, meta, node, {
        message: inferredJobs.has(jobName)
          ? `Job "${jobName}" uses a CircleCI Gradle orb without visible build cache configuration in the repository.`
          : `Job "${jobName}" runs Gradle tasks without visible build cache configuration in the repository.`,
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
