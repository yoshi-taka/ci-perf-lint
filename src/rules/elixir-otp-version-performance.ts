import type { Node } from "yaml";
import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  checkElixirVersion,
  checkOtpVersion,
  detectElixirContainer,
  detectSetupBeam,
  extractOtpFromContainerImage,
  extractOtpFromElixirVersion,
  parseOtpVersion,
} from "./shared/elixir-versions.ts";

const meta = {
  id: "elixir-otp-version-performance",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/elixir-otp-version-performance.md",
} satisfies RuleMeta;

export const elixirOtpVersionPerformanceRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    for (const job of workflow.jobs) {
      const setupBeam = detectSetupBeam(job);
      const container = detectElixirContainer(job);

      if (!setupBeam && !container) {
        continue;
      }

      let effectiveOtp: number | undefined;
      let effectiveElixirVersion: string | undefined;
      let usedNode: Node | undefined;

      if (setupBeam) {
        usedNode = setupBeam.step.usesNode ?? setupBeam.step.node;

        if (setupBeam.otpVersion) {
          effectiveOtp = parseOtpVersion(setupBeam.otpVersion);
        }

        if (setupBeam.elixirVersion) {
          effectiveElixirVersion = setupBeam.elixirVersion;

          effectiveOtp ??= extractOtpFromElixirVersion(setupBeam.elixirVersion);
        }
      }

      if (container && !setupBeam) {
        usedNode = container.node;
        effectiveElixirVersion = container.image.replace(/^elixir:/, "");
        effectiveOtp = extractOtpFromContainerImage(container.image);
      }

      if (effectiveOtp !== undefined) {
        const finding = checkOtpVersion(effectiveOtp);
        if (finding) {
          findings.push(
            buildDiagnostic(workflow, meta, usedNode, {
              message: `${finding.message} (detected OTP ${effectiveOtp} in job "${job.id}").`,
              why: "OTP 25 has known performance regressions in CI test and runtime execution.",
              suggestion: finding.suggestion,
              measurementHint: "Benchmark test suite runtime on OTP 26 vs 25.",
              aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} for OTP version configuration.`,
              score: 58,
            }),
          );
        }
      }

      if (effectiveElixirVersion) {
        const finding = checkElixirVersion(effectiveElixirVersion);
        if (finding) {
          findings.push(
            buildDiagnostic(workflow, meta, usedNode, {
              message: `${finding.message} (detected Elixir ${effectiveElixirVersion} in job "${job.id}").`,
              why: "Elixir version impacts compilation and boot times in CI.",
              suggestion: finding.suggestion,
              measurementHint: "Benchmark compile times on the recommended Elixir version.",
              aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} for Elixir version configuration.`,
              score: 58,
            }),
          );
        }
      }
    }

    return findings;
  },
};
