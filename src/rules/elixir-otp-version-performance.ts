import type { Node } from "yaml";
import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { getMapValue, getScalarValue } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  checkElixirVersion,
  checkOtpVersion,
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

interface SetupBeamDetected {
  step: WorkflowStep;
  otpVersion?: string;
  elixirVersion?: string;
}

function detectSetupBeam(job: WorkflowJob): SetupBeamDetected | undefined {
  for (const step of job.steps) {
    const uses = step.uses?.toLowerCase() ?? "";
    if (!uses.startsWith("erlef/setup-beam@")) {
      continue;
    }

    const withValues = step.with;
    if (!withValues) {
      continue;
    }

    const rawOtp = withValues["otp-version"];
    const rawElixir = withValues["elixir-version"];
    return {
      step,
      otpVersion:
        typeof rawOtp === "string" || typeof rawOtp === "number" ? String(rawOtp) : undefined,
      elixirVersion:
        typeof rawElixir === "string" || typeof rawElixir === "number"
          ? String(rawElixir)
          : undefined,
    };
  }
  return undefined;
}

interface ContainerDetected {
  image: string;
  node?: Node;
}

function detectElixirContainer(job: WorkflowJob): ContainerDetected | undefined {
  const containerStr = getScalarValue(job.node, "container");
  if (typeof containerStr === "string" && containerStr.toLowerCase().startsWith("elixir:")) {
    return { image: containerStr, node: job.node };
  }

  const containerMap = getMapValue(job.node, "container");
  if (containerMap) {
    const image = containerMap.image;
    if (typeof image === "string" && image.toLowerCase().startsWith("elixir:")) {
      return { image, node: job.node };
    }
  }

  return undefined;
}

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
