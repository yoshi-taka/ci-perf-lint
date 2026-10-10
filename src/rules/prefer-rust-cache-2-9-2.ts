import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import { getScalarValue, type WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";
import {
  jobAllowsActionsCacheRestore,
  jobAllowsActionsCacheSave,
} from "./shared/workflow-caches.ts";

const meta = {
  id: "prefer-rust-cache-2-9-2",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-rust-cache-2-9-2.md",
} satisfies RuleMeta;

export const preferRustCache292Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (
        jobIsStaticallyDisabled(job) ||
        !jobAllowsActionsCacheRestore(workflow, job) ||
        !jobAllowsActionsCacheSave(workflow, job)
      ) {
        continue;
      }
      const offenders = job.steps.filter(
        (step) =>
          cacheActionVersionIsBelow(step, "Swatinem/rust-cache", [2, 9, 2]) &&
          getScalarValue(step.node, "if") !== false &&
          step.if?.trim() !== "false" &&
          step.with?.["cache-targets"] !== false &&
          step.with?.["cache-targets"] !== "false" &&
          step.with?.["save-if"] !== false &&
          step.with?.["save-if"] !== "false",
      );
      const anchor = offenders[0];
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" pins rust-cache below the 2.9.2 target-cache milestone: ${offenders.map((step) => step.uses).join(", ")}.`,
          why: "rust-cache 2.9.2 includes cleanup fixes that retain build and fingerprint artifacts when library target names differ from package names, including cdylib/rlib/dylib/staticlib targets. Older cleanup can discard reusable dependency artifacts and force rebuilds on later runs. This benefit applies across operating systems and depends on the dependency graph.",
          suggestion:
            "Upgrade Swatinem/rust-cache to v2.9.2 or a later compatible release while preserving workspaces, cache keys, provider, and save policy. Check Node 24 runner compatibility and any intentional older pin before upgrading.",
          measurementHint:
            "Compare warm cargo build/test duration and which dependencies recompile after restoring the cache. A cache hit alone does not prove the needed build/fingerprint artifacts were retained.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade old rust-cache refs to v2.9.2 or later. Keep provider, workspaces, and save conditions, inspect any intentional pin, and compare warm dependency rebuilds rather than just cache-hit output.`,
          score: 50,
        }),
      );
    }
    return findings;
  },
};
