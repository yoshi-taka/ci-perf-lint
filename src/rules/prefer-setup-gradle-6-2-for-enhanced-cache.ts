import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import {
  getScalarValue,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
} from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import { jobAllowsActionsCacheSave } from "./shared/workflow-caches.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";

const action = "gradle/actions/setup-gradle";
const meta = {
  id: "prefer-setup-gradle-6-2-for-enhanced-cache",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-gradle-6-2-for-enhanced-cache.md",
} satisfies RuleMeta;

function enabled(step: WorkflowStep): boolean {
  return getScalarValue(step.node, "if") !== false && step.if?.trim() !== "false";
}

function falseOrDefault(value: unknown): boolean {
  return (
    value === undefined ||
    value === false ||
    (typeof value === "string" && value.trim().toLowerCase() === "false")
  );
}

function pullRequestOnly(workflow: WorkflowDocument): boolean {
  const on = workflow.on;
  const events =
    typeof on === "string"
      ? [on]
      : Array.isArray(on)
        ? on
        : on && typeof on === "object"
          ? Object.keys(on)
          : [];
  return events.length > 0 && events.every((event) => event === "pull_request");
}

function canWriteEnhancedCache(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): boolean {
  const inputs = step.with ?? {};
  if (inputs["cache-provider"] !== undefined && inputs["cache-provider"] !== "enhanced") {
    return false;
  }
  if (!falseOrDefault(inputs["cache-disabled"]) || !falseOrDefault(inputs["cache-read-only"])) {
    return false;
  }
  const cleanup = inputs["cache-cleanup"];
  if (cleanup !== undefined && cleanup !== "on-success" && cleanup !== "always") {
    return false;
  }
  if (
    inputs["gradle-home-cache-cleanup"] === false ||
    inputs["gradle-home-cache-cleanup"] === "false"
  ) {
    return false;
  }
  const writeOnly = inputs["cache-write-only"] === true || inputs["cache-write-only"] === "true";
  if (inputs["cache-read-only"] === undefined && !writeOnly) {
    const jobIf = typeof job.raw.if === "string" ? job.raw.if.trim() : "";
    if (
      pullRequestOnly(workflow) ||
      /^(?:\$\{\{\s*)?github\.event_name\s*==\s*['"]pull_request['"]\s*(?:\}\})?$/.test(jobIf)
    ) {
      return false;
    }
  }
  return jobAllowsActionsCacheSave(workflow, job);
}

function runsGradleTask(step: WorkflowStep): boolean {
  if (!enabled(step)) {
    return false;
  }
  return shellCommandSegments(step.run ?? "").some((command) => {
    const normalized = command
      .replace(/\$\{\{[\s\S]*?\}\}/g, "__dynamic__")
      .replace(/(^|\s)\.\\gradlew\.bat(?=\s|$)/g, "$1./gradlew.bat");
    const words = staticShellWords(normalized);
    if (!words) {
      return false;
    }
    while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) {
      words.shift();
    }
    const executable = words.shift()?.split(/[/\\]/).at(-1);
    if (
      !/^(?:gradle|gradlew(?:\.bat)?)$/.test(executable ?? "") ||
      words.some((word) => ["--version", "-v", "--help", "-h"].includes(word))
    ) {
      return false;
    }
    const valueFlags = new Set([
      "-p",
      "--project-dir",
      "-g",
      "--gradle-user-home",
      "-I",
      "--init-script",
      "-b",
      "--build-file",
      "-c",
      "--settings-file",
      "--include-build",
      "--console",
      "--warning-mode",
      "-x",
      "--exclude-task",
      "-P",
      "-D",
    ]);
    for (let index = 0; index < words.length; index++) {
      const word = words[index]!;
      if (valueFlags.has(word)) {
        index++;
      } else if (/^(?:[\w-]*:)*[A-Za-z][\w-]*$/.test(word)) {
        return true;
      }
    }
    return false;
  });
}

export const preferSetupGradle62ForEnhancedCacheRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders = job.steps.filter(
        (step, index) =>
          enabled(step) &&
          !cacheActionVersionIsBelow(step, action, [6, 0, 0]) &&
          cacheActionVersionIsBelow(step, action, [6, 2, 0]) &&
          canWriteEnhancedCache(workflow, job, step) &&
          job.steps.slice(index + 1).some(runsGradleTask),
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" builds with Enhanced caching and setup-gradle v6 below 6.2: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "setup-gradle 6.2 makes Enhanced cache cleanup inspect filesystem state without launching Gradle or a JVM in the post step. It also stores the local build cache separately and excludes transient housekeeping files, reducing cache size and improving reuse. These changes concern Gradle User Home caching, not enabling Gradle task-output caching.",
          suggestion:
            "Upgrade gradle/actions/setup-gradle within v6 to v6.2.0 or a later compatible release, keeping Enhanced caching, cache read/write and cleanup policies, keys and paths intact. Preserve the Gradle version, wrapper and dependency-graph/Build Scan settings. Measure post-step time and cache transfer rather than assuming a build-task speedup.",
          measurementHint:
            "Compare cache-cleanup/post-step duration, cache size, restore/save time and total job duration with the same Gradle tasks and cache state. Verify equivalent task outputs and cache behavior.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and update its old v6 setup-gradle refs to v6.2.0 or later. Keep Enhanced provider, cache permissions, cleanup, keys, paths and Gradle version unchanged, then compare post-step JVM startup and cache-transfer costs.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
