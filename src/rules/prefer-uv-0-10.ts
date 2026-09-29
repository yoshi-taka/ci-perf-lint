import type { Node } from "yaml";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  extractPinnedUvInstallSpec,
  preferModernUvVersionMeasurementHint,
  preferModernUvVersionMeta as meta,
  preferModernUvVersionSuggestion,
  uvVersionSpecIsBelowModern,
} from "./shared/uv-versions.ts";

function readUvVersionInput(step: WorkflowStep): string | undefined {
  const raw = step.with?.version ?? step.with?.["uv-version"];
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }
  return undefined;
}

interface OffendingStep {
  node: Node | undefined;
  detail: string;
}

function collectJobOffenders(job: WorkflowJob): OffendingStep[] {
  const offenders: OffendingStep[] = [];

  for (const step of job.steps) {
    const uses = step.uses?.toLowerCase() ?? "";
    if (uses.startsWith("astral-sh/setup-uv@")) {
      const declared = readUvVersionInput(step);
      if (declared && uvVersionSpecIsBelowModern(declared)) {
        offenders.push({
          node: step.usesNode ?? step.node,
          detail: `setup-uv pins uv ${declared}`,
        });
      }
    }

    const pinnedInstall = extractPinnedUvInstallSpec(step.run ?? "");
    if (pinnedInstall && uvVersionSpecIsBelowModern(pinnedInstall)) {
      offenders.push({
        node: step.runNode ?? step.node,
        detail: `a uv install pins uv ${pinnedInstall}`,
      });
    }
  }

  return offenders;
}

export const preferUv010Rule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const offenders = collectJobOffenders(job);
      if (offenders.length === 0) {
        continue;
      }

      const anchor = offenders[0]!;
      const detailText = offenders.map((offender) => offender.detail).join("; ");

      findings.push(
        buildDiagnostic(workflow, meta, anchor.node, {
          message: `Job "${job.id}" installs uv below 0.10 (${detailText}).`,
          why: "uv 0.10 stabilized Python version management and carried a batch of correctness and performance fixes. Pinning an older uv keeps CI on the slower resolver and misses the stabilized upgrade paths and bug fixes that reduce repeated resolution and install work.",
          suggestion: preferModernUvVersionSuggestion,
          measurementHint: preferModernUvVersionMeasurementHint,
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and raise the uv version to at least 0.10.x. Update the astral-sh/setup-uv version input and any pinned pip/pipx uv installs together, then re-run the job to confirm dependency resolution and installs are unchanged.`,
          score: 52,
        }),
      );
    }

    return findings;
  },
};
