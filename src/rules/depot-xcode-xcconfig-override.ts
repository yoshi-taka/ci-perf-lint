import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  jobOptsOutOfDepotXcodeCache,
  jobRunsDepotMacosXcode,
  xcconfigOverrideForStep,
  xcodebuildSteps,
} from "./shared/depot-xcode.ts";

const meta = {
  id: "depot-xcode-xcconfig-override",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/depot-xcode-xcconfig-override.md",
} satisfies RuleMeta;

export const depotXcodeXcconfigOverrideRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext): Diagnostic[] {
    return workflow.jobs.flatMap((job) => {
      if (!jobRunsDepotMacosXcode(job) || jobOptsOutOfDepotXcodeCache(workflow, job)) {
        return [];
      }
      const override = xcodebuildSteps(job)
        .map((step) => xcconfigOverrideForStep(workflow, job, step))
        .find((candidate) => candidate !== undefined);
      if (!override) {
        return [];
      }
      return [
        buildDiagnostic(workflow, meta, override.node, {
          message: `Job "${job.id}" overrides XCODE_XCCONFIG_FILE, so Depot's Xcode compilation cache is not applied.`,
          why: "Depot macOS runners configure Xcode 26+ compilation caching through a generated xcconfig referenced by XCODE_XCCONFIG_FILE. When the job sets its own value, the runner leaves it unchanged and Xcode does not use Depot Cache. An organization or job opt-out is respected by this rule.",
          suggestion:
            "Remove the XCODE_XCCONFIG_FILE override on this job so the runner's cache configuration applies. If a custom xcconfig is required, confirm with Depot's documentation before combining settings; do not assume an include path is supported.",
          measurementHint:
            "Add depot/xcode-compilation-cache-summary@v1 after the xcodebuild step and compare hit rate, downloaded/uploaded bytes and build time before and after removing the override.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and remove only the XCODE_XCCONFIG_FILE override. Preserve other build settings and check upstream documentation before attempting to layer custom xcconfig settings onto Depot's configuration.`,
          score: 62,
        }),
      ];
    });
  },
};
