import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { isBlacksmithStickyDiskCacheStep } from "./shared/blacksmith-caches.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import { getRunsOnSpec, jobRunsOnBlacksmithRunner } from "./shared/runs-on-facts.ts";

const meta = {
  id: "blacksmith-sticky-disk-cache-overlap",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/blacksmith-sticky-disk-cache-overlap.md",
} satisfies RuleMeta;

/** Compare literal paths only; never equate a runner-specific absolute home with ~. */
function cachePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const text = value.trim().replace(/^\$(?:HOME|\{HOME\})\//, "~/");
  if (/[$`\\*?[\]{}!\r\n]/.test(text) || text.split("/").includes("..")) {
    return undefined;
  }
  return path.posix.normalize(text).replace(/\/+$/, "") || "/";
}

function archivePaths(step: WorkflowStep, npmConfigUnknown: boolean): string[] {
  if (step.ifNode) {
    return [];
  }
  const uses = step.uses?.toLowerCase() ?? "";
  if (/^actions\/setup-node@/.test(uses)) {
    const major = /^actions\/setup-node@v(\d+)(?:\.\d+(?:\.\d+)?)?$/.exec(uses)?.[1];
    return major !== undefined &&
      Number(major) >= 3 &&
      step.with?.cache === "npm" &&
      !npmConfigUnknown
      ? ["~/.npm"]
      : [];
  }
  // Split restore/save actions and partial/glob paths need separate lifecycle analysis.
  if (
    !/^actions\/cache@/.test(uses) ||
    typeof step.with?.key !== "string" ||
    !step.with.key.trim() ||
    typeof step.with.path !== "string"
  ) {
    return [];
  }
  return step.with.path.split(/\r?\n/).flatMap((line) => {
    const normalized = cachePath(line);
    return normalized === undefined ? [] : [normalized];
  });
}

export const blacksmithStickyDiskCacheOverlapRule = {
  meta,
  check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        job.usesReusableWorkflow ||
        job.raw.container ||
        !jobRunsOnBlacksmithRunner(job) ||
        !getRunsOnSpec(job).isUbuntu
      ) {
        continue;
      }
      const disks = new Set<string>();
      const archives = new Set<string>();
      const reported = new Set<string>();
      let location: WorkflowStep | undefined;
      for (const step of job.steps) {
        // Unknown execution can change HOME, npm configuration, mounts or workspace paths.
        // Abstain for the remaining job, including when setup appears after that execution.
        const uses = step.uses?.toLowerCase() ?? "";
        const environment = effectiveStepEnvironment(workflow, job, step);
        if (
          step.run !== undefined ||
          Object.keys(environment).some((name) =>
            /^(?:HOME|USERPROFILE|XDG_CACHE_HOME|NODE_OPTIONS|BASH_ENV|ENV|npm_config_.*)$/i.test(
              name,
            ),
          ) ||
          (uses &&
            !/^(?:(?:actions|useblacksmith)\/checkout|actions\/(?:setup-node|cache)|useblacksmith\/stickydisk)@/.test(
              uses,
            ))
        ) {
          break;
        }
        // A checkout between cache steps can replace a workspace path.
        if (/^(?:actions|useblacksmith)\/checkout@/.test(uses)) {
          disks.clear();
          archives.clear();
          continue;
        }
        const diskPath = isBlacksmithStickyDiskCacheStep(job, step)
          ? cachePath(step.with?.path)
          : undefined;
        if (diskPath !== undefined) {
          disks.add(diskPath);
        }
        const paths = archivePaths(step, context.repository.npm.npmrcFiles.length > 0);
        for (const entry of paths) {
          archives.add(entry);
        }
        for (const entry of diskPath === undefined ? paths : [diskPath]) {
          if (!disks.has(entry) || !archives.has(entry) || reported.has(entry)) {
            continue;
          }
          reported.add(entry);
          location ??= step;
        }
      }
      if (location) {
        const paths = [...reported].map((entry) => `"${entry}"`).join(", ");
        findings.push(
          buildDiagnostic(workflow, meta, location.withNode ?? location.node, {
            message: `Job "${job.id}" configures Sticky Disk and archive caching for the same paths: ${paths}.`,
            why: "Both cache strategies can add restore/save work for the same directory. Mount and post-step order can also make them operate on different directory contents.",
            suggestion:
              "Review whether one cache strategy is sufficient. Keep archive caching needed by other runners, fallback or migration; verify actual paths and conditions before disabling it.",
            measurementHint:
              "Compare archive restore/save and Sticky Disk snapshot time across warm runs. Verify hit behavior and consumers; configuration overlap alone does not prove a speedup.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}: Sticky Disk and archive caching overlap at ${paths}. Check actual paths, mount/unmount and post-step order, external consumers, fallback and trust boundaries. Do not automatically remove or reorder either cache.`,
            score: 40,
          }),
        );
      }
    }
    return findings;
  },
};
