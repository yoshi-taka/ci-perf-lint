import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { hasDirectHeavySignals, isHeavyJob } from "./shared/workflow-jobs.ts";

const meta = {
  id: "consider-slim-over-alpine-for-ci",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-slim-over-alpine-for-ci.md",
} satisfies RuleMeta;

function getContainerImage(job: WorkflowJob): string | undefined {
  const container = job.raw.container;
  if (typeof container === "string") {
    return container;
  }

  if (!container || typeof container !== "object" || Array.isArray(container)) {
    return undefined;
  }

  const image = (container as Record<string, unknown>).image;
  return typeof image === "string" ? image : undefined;
}

function jobLooksLikeCiExecution(job: WorkflowJob): boolean {
  return isHeavyJob(job) || hasDirectHeavySignals(job);
}

export const considerSlimOverAlpineForCiRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      const image = getContainerImage(job);
      if (!image || !/(?:^|[:/@-])(alpine|musl)(?:$|[:/@-])/i.test(image)) {
        continue;
      }

      if (!jobLooksLikeCiExecution(job)) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          message: `Job "${job.id}" runs in Alpine or musl-based container image "${image}".`,
          why: "Alpine or musl-based containers can be the right choice, but they often add friction for wheels, native addons, and prebuilt binaries in CI. That can increase package-install complexity or cause unexpected fallbacks to source builds. If musl compatibility is not actually required on this path, a slim Debian-based image is often easier to maintain.",
          suggestion:
            "Confirm whether Alpine or musl is truly required for this CI path. If not, consider a slim Debian-based image instead and compare total job time and setup complexity.",
          measurementHint:
            "Compare total job duration, package-install complexity, and source-build or native-build frequency between the current Alpine or musl image and a slim Debian-based image.",
          aiHandoff:
            "Review whether this CI job really needs Alpine or musl compatibility. If not, test an equivalent slim Debian-based image and only keep the switch if it reduces package-install friction, source-build fallbacks, or total runtime without changing required behavior.",
          score: 29,
        }),
      );
    }
    return findings;
  },
};
