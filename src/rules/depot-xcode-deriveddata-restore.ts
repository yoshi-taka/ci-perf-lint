import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  firstXcodebuildStep,
  jobOptsOutOfDepotXcodeCache,
  jobRunsDepotMacosXcode,
  xcodebuildDisablesCaching,
} from "./shared/depot-xcode.ts";

const meta = {
  id: "depot-xcode-deriveddata-restore",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/depot-xcode-deriveddata-restore.md",
} satisfies RuleMeta;

function cachePathText(step: WorkflowStep): string {
  const value = step.with?.path;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").join("\n")
    : typeof value === "string"
      ? value
      : "";
}

function isDerivedDataRestoreStep(step: WorkflowStep): boolean {
  return (
    /^actions\/cache(?:\/restore)?@/i.test(step.uses ?? "") &&
    /deriveddata/i.test(cachePathText(step))
  );
}

/** Conditional restores are not assumed to run alongside the build. */
function isUnresolvedIf(step: WorkflowStep): boolean {
  return Boolean(step.ifNode) && step.if !== "true";
}

export const depotXcodeDeriveddataRestoreRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    return workflow.jobs.flatMap((job) => {
      if (!jobRunsDepotMacosXcode(job) || jobOptsOutOfDepotXcodeCache(workflow, job)) {
        return [];
      }
      const build = firstXcodebuildStep(job)!;
      if (xcodebuildDisablesCaching(build)) {
        return [];
      }
      const buildIndex = job.steps.indexOf(build);
      const restore = job.steps.find(
        (step, index) =>
          index < buildIndex && isDerivedDataRestoreStep(step) && !isUnresolvedIf(step),
      );
      if (!restore) {
        return [];
      }
      return [
        buildDiagnostic(workflow, meta, restore.usesNode ?? restore.node, {
          message: `Job "${job.id}" restores DerivedData before xcodebuild on a Depot macOS runner.`,
          why: "Depot notes that when DerivedData is already populated, Xcode might not use Depot Cache at all. The cache restore and save also add transfer time that compilation caching may make unnecessary. This is advisory: a populated DerivedData can still be useful for other builds.",
          suggestion:
            "On Depot macOS runners, try removing only the DerivedData restore/save pair. Keep separate SwiftPM or CocoaPods cache paths if they do not include DerivedData, and verify total job time before keeping the change.",
          measurementHint:
            "Add depot/xcode-compilation-cache-summary@v1 after the build and compare hit rate, build time and cache transfer time with and without the DerivedData restore.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and test removing only the DerivedData cache. Preserve other cache paths, build settings and publication steps; verify that cache hits and total time improve.`,
          score: 34,
        }),
      ];
    });
  },
};
