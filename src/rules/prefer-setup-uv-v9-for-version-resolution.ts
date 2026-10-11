import path from "node:path";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import {
  getScalarValue,
  type WorkflowDocument,
  type WorkflowJob,
  type WorkflowStep,
} from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { cacheActionVersionIsBelow } from "./shared/cache-action-versions.ts";
import { workflowStepEnv } from "./shared/workflow-command-context.ts";
import { jobIsStaticallyDisabled } from "./shared/workflow-jobs.ts";

const meta = {
  id: "prefer-setup-uv-v9-for-version-resolution",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-setup-uv-v9-for-version-resolution.md",
} satisfies RuleMeta;

const defaultManifest = "https://raw.githubusercontent.com/astral-sh/versions/main/v1/uv.ndjson";

function literalInput(raw: unknown, env: Record<string, unknown>): string | undefined {
  if (raw === undefined) {
    return "";
  }
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  let value = String(raw).trim();
  const reference = /^\$\{\{\s*env\.([A-Za-z_][A-Za-z_\d]*)\s*\}\}$/.exec(value);
  if (reference) {
    const resolved = env[reference[1]!];
    if (typeof resolved !== "string" && typeof resolved !== "number") {
      return undefined;
    }
    value = String(resolved).trim();
  }
  return value.includes("${{") ? undefined : value;
}

function isRange(version: string): boolean {
  // Recognize common semver/PEP 440 ranges, not arbitrary strings or exact pins.
  const normalized = version.replace(/^==?/, "");
  if (/^v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(normalized)) {
    return false;
  }
  return (
    /^(?:v?\d+(?:\.(?:\d+|x|\*)){0,2}|\*)$/.test(normalized) ||
    /^(?:(?:>=?|<=?|!=|==|~=|~|\^|=)\s*\d+(?:\.(?:\d+|\*)){0,2})(?:(?:\s*,\s*|\s+)(?:>=?|<=?|!=|==|~=|~|\^|=)\s*\d+(?:\.(?:\d+|\*)){0,2})*$/.test(
      version,
    )
  );
}

async function resolvesLatestByDefault(
  step: WorkflowStep,
  env: Record<string, unknown>,
  context: RuleContext,
): Promise<boolean> {
  const scan = context.scanContext;
  if (!scan || literalInput(step.with?.["version-file"], env) !== "") {
    return false;
  }
  const rawDirectory = step.with?.["working-directory"];
  const directory =
    rawDirectory === "${{ github.workspace }}" ? "." : literalInput(rawDirectory, env);
  if (directory === undefined) {
    return false;
  }
  const relativeDirectory = directory || ".";
  if (path.isAbsolute(relativeDirectory) || relativeDirectory.split(/[\\/]/).includes("..")) {
    return false;
  }
  for (const file of ["uv.toml", "pyproject.toml"]) {
    const filePath = scan.resolve(relativeDirectory, file);
    if (!(await scan.pathExists(filePath))) {
      continue;
    }
    const text = await scan.readTextFileOrWarn(filePath);
    // Abstain when a file may select a version; do not guess TOML/dependency semantics.
    if (text === undefined || /required-version|["']uv(?:[<>=!~;"'[])/i.test(text)) {
      return false;
    }
  }
  return true;
}

async function resolutionEvidence(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
  context: RuleContext,
): Promise<string | undefined> {
  const env = workflowStepEnv(workflow, job, step);
  const manifest = literalInput(step.with?.["manifest-file"], env);
  const strategy = literalInput(step.with?.["resolution-strategy"], env);
  if (manifest !== "" && manifest !== defaultManifest) {
    return undefined;
  }
  if (strategy !== "" && strategy !== "highest") {
    return undefined;
  }
  const version = literalInput(step.with?.version, env);
  if (version === "latest" || (version && isRange(version))) {
    return version;
  }
  if (version === "" && (await resolvesLatestByDefault(step, env, context))) {
    return "latest (workspace default)";
  }
  return undefined;
}

export const preferSetupUvV9ForVersionResolutionRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (jobIsStaticallyDisabled(job)) {
        continue;
      }
      const offenders: { step: WorkflowStep; version: string }[] = [];
      for (const step of job.steps) {
        if (
          !cacheActionVersionIsBelow(step, "astral-sh/setup-uv", [9, 0, 0]) ||
          getScalarValue(step.node, "if") === false ||
          step.if?.trim() === "false"
        ) {
          continue;
        }
        const version = await resolutionEvidence(workflow, job, step, context);
        if (version) {
          offenders.push({ step, version });
        }
      }
      const anchor = offenders[0]?.step;
      if (!anchor) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, anchor.usesNode ?? anchor.node, {
          message: `Job "${job.id}" resolves uv latest/ranges with setup-uv before v9: ${offenders.map(({ step, version }) => `${step.uses} (${version})`).join(", ")}.`,
          why: "setup-uv v9 streams the standard newest-first version manifest and stops reading once the latest or highest matching version is found, reducing version-resolution runtime and network transfer. Earlier releases read the full manifest; releases before v7.5 also used GitHub release enumeration. This targets Action setup overhead, not uv dependency installation speed; savings depend on the matching version's position and network conditions.",
          suggestion:
            "Upgrade astral-sh/setup-uv to v9 or a later compatible release while preserving the uv version/range and highest resolution strategy. v9 changes prune-cache's default from true to false: explicitly set prune-cache: true if preserving the old pruning policy, or retain an existing explicit value. Preserve cache inputs, Python version and environment activation; check Node 24 runner support.",
          measurementHint:
            "Compare setup-uv version-resolution and total setup duration with the same uv version constraint, runner and cache state. Confirm the resolved uv version and cache/pruning behavior are unchanged.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and upgrade old setup-uv refs to v9 or later. Keep uv constraints, highest resolution, Python/activation and cache inputs. Preserve pruning explicitly across the v9 default change and measure setup duration.`,
          score: 45,
        }),
      );
    }
    return findings;
  },
};
