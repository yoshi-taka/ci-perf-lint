import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { collectCommandEntries } from "../rules/shared/any-step.ts";
import { collectGradleCommands } from "../rules/shared/gradle-commands.ts";
import { shellCommands } from "../rules/shared/command-patterns.ts";
import { circleCiHasGradleOrbEvidence } from "../circleci-gradle-evidence.ts";

const meta = {
  id: "missing-gradle-build-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/missing-gradle-build-cache.md",
} satisfies RuleMeta;

function scriptCandidate(words: string[]): string | undefined {
  const first = words[0] ?? "";
  if (["bash", "sh", "zsh", "source", "."].includes(first)) {
    return words[1];
  }
  if (first.endsWith(".sh") || first.startsWith("./") || first.startsWith("scripts/")) {
    return first;
  }
  return undefined;
}

async function referencedScriptMentionsGradle(
  context: RepositoryDiagnosticContext,
  text: string,
): Promise<boolean> {
  for (const words of shellCommands(text)) {
    const candidate = scriptCandidate(words);
    if (!candidate || candidate.includes("$") || path.isAbsolute(candidate)) {
      continue;
    }
    const target = path.resolve(context.repoRoot, candidate);
    const relative = path.relative(context.repoRoot, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      continue;
    }
    if (!(await context.scanContext.pathExists(target))) {
      continue;
    }
    const script = await context.scanContext.readTextFileOrWarn(target);
    if (script && /\bgradlew?\b/i.test(script)) {
      return true;
    }
  }
  return false;
}

export async function collectGradleBuildCacheNotConfiguredDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (
    !context.repository.frameworks.usesGradle ||
    context.repository.frameworks.gradleBuildCacheConfigured
  ) {
    return [];
  }
  const documents = context.documents ?? [];
  if (documents.length === 0) {
    return [];
  }

  const hasVisibleGradleWork =
    documents.some((document) =>
      collectCommandEntries(document).some(
        (entry) => collectGradleCommands(entry.text, {}, entry.workingDirectory).length > 0,
      ),
    ) ||
    documents.some(
      (document) => document.kind === "circleci" && circleCiHasGradleOrbEvidence(document),
    );
  if (hasVisibleGradleWork) {
    return [];
  }

  const hiddenScriptEvidence = (
    await Promise.all(
      documents.flatMap((document) =>
        collectCommandEntries(document).map((entry) =>
          referencedScriptMentionsGradle(context, entry.text),
        ),
      ),
    )
  ).some(Boolean);
  if (!hiddenScriptEvidence) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      location: { path: "gradle.properties", line: 1, column: 1 },
      message:
        "Gradle build cache is not configured although a referenced CI script invokes Gradle.",
      why: "Gradle build cache reuses task outputs across builds, but neither a `buildCache` block in settings nor `org.gradle.caching=true` in gradle.properties is visible. The Gradle invocation is inside a referenced script, so only the repository-level setting can be checked.",
      suggestion:
        "If CI repeats Gradle build or test tasks, add `org.gradle.caching=true` to gradle.properties and verify total job time improves.",
      measurementHint:
        "Compare Gradle task duration, reported build-cache hits, and total job time before and after enabling build cache.",
      aiHandoff:
        "Review the referenced CI script that invokes Gradle and add org.gradle.caching=true to gradle.properties if repeated build/test work can be reused. Verify the result with build-cache hit logs and total job time.",
      score: 48,
    }),
  ];
}
