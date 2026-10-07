import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  pnpm1210Advice,
  pnpmVersionIsBelow1210,
  preferPnpm1210Meta as meta,
} from "./shared/pnpm-versions.ts";

export const preferPnpm1210Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      const offenders = job.steps.filter(
        (step) =>
          step.uses?.toLowerCase().startsWith("pnpm/action-setup@") &&
          pnpmVersionIsBelow1210(step.with?.version),
      );
      const anchor = offenders[0];
      if (!anchor) {
        return [];
      }
      return [
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          ...pnpm1210Advice,
          message: `Job "${job.id}" pins pnpm below 12.10 in pnpm/action-setup (${offenders.map((step) => String(step.with?.version)).join(", ")}).`,
          aiHandoff: `Update pnpm/action-setup version inputs in ${workflow.relativePath} job "${job.id}" to a stable pnpm 12.10.0 or later and align the packageManager pin. Check removed --resolution-only and explicit --frozen-lockfile boolean arguments, Git dependency transport, and engineStrict behavior when crossing major versions. Verify frozen installs and scripts, then measure install duration.`,
        }),
      ];
    });
  },
};
