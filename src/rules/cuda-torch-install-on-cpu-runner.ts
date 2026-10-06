import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnStandardX64Ubuntu } from "./shared/runs-on-facts.ts";

const meta = {
  id: "cuda-torch-install-on-cpu-runner",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/cuda-torch-install-on-cpu-runner.md",
} satisfies RuleMeta;

const standardUbuntuX64LabelPattern = /^ubuntu-(?:latest|\d{2}\.\d{2})$/;
const matrixRunsOnPattern = /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/;

const cudaBuildSignalPattern =
  /\bTORCH_CUDA_ARCH_LIST\b|\bCUDA_HOME\b|\bCUDA_PATH\b|\bCUDA_COMPUTE_CAP\b|\bLIBTORCH_USE_PYTORCH\b|\bnvcc\b|cuda-toolkit|\/whl\/cu|and-cuda/i;

const installCommandPattern =
  /\b(?:(?:python3?|py)\s+-m\s+pip|pip3?)\s+install\b|\buv\s+pip\s+install\b|\buv\s+add\b|\bpoetry\s+add\b/i;

const torchPackagePattern = /\btorch(?:vision|audio)?\b/i;

const cpuInstallPattern =
  /--index-url[=\s]+\S*\/whl\/cpu|--find-links[=\s]+\S*\/cpu\b|\+cpu\b|--torch-backend[=\s]+(?:cpu|auto)\b/i;

const cpuEnvPattern = /\bUV_TORCH_BACKEND\b\s*[:=]\s*["']?(?:cpu|auto)\b/i;
const cpuIndexEnvPattern = /\bPIP_(?:EXTRA_)?INDEX_URL\b\s*[:=]\s*["']?\S*\/whl\/cpu/i;

function textify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textify).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${textify(entry)}`)
      .join("\n");
  }
  return "";
}

function isStandardUbuntuX64Label(label: string): boolean {
  return standardUbuntuX64LabelPattern.test(label.trim().toLowerCase());
}

function getMatrixAxisValues(job: WorkflowJob, axis: string): string[] | undefined {
  const strategy = job.raw.strategy;
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) {
    return undefined;
  }
  const matrix = (strategy as Record<string, unknown>).matrix;
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    return undefined;
  }

  const record = matrix as Record<string, unknown>;
  const values = record[axis];
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const resolved: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      return undefined;
    }
    resolved.push(value);
  }

  const include = record.include;
  if (Array.isArray(include)) {
    for (const entry of include) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const value = (entry as Record<string, unknown>)[axis];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== "string") {
        return undefined;
      }
      resolved.push(value);
    }
  }

  return resolved;
}

function jobTargetsStandardUbuntuX64(job: WorkflowJob): boolean {
  const runsOn = job.raw["runs-on"];
  if (typeof runsOn === "string") {
    const match = matrixRunsOnPattern.exec(runsOn.trim());
    if (match?.[1]) {
      const values = getMatrixAxisValues(job, match[1]);
      if (!values || values.length === 0) {
        return false;
      }
      return values.every(isStandardUbuntuX64Label);
    }
  }

  return jobRunsOnStandardX64Ubuntu(job);
}

function stepIfExcludesLinux(step: WorkflowStep): boolean {
  const condition = step.if?.toLowerCase() ?? "";
  if (condition.length === 0) {
    return false;
  }
  const mentionsNonLinux = /macos|windows/.test(condition);
  const mentionsLinux = /linux|ubuntu/.test(condition);
  return mentionsNonLinux && !mentionsLinux;
}

function hasCpuInstallIntent(
  stepRun: string,
  jobEnvText: string,
  workflowEnvText: string,
): boolean {
  if (cpuInstallPattern.test(stepRun)) {
    return true;
  }
  const env = `${workflowEnvText}\n${jobEnvText}`;
  return cpuEnvPattern.test(env) || cpuIndexEnvPattern.test(env);
}

function collectTorchPackages(step: WorkflowStep): string[] {
  if (!step.run || stepIfExcludesLinux(step)) {
    return [];
  }

  const packages = new Set<string>();
  for (const line of step.run.split("\n")) {
    if (!installCommandPattern.test(line) || !torchPackagePattern.test(line)) {
      continue;
    }
    for (const token of line.match(/\btorch(?:vision|audio)?\b/gi) ?? []) {
      packages.add(token.toLowerCase());
    }
  }
  return [...packages];
}

export const cudaTorchInstallOnCpuRunnerRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    const workflowEnvText = textify(workflow.parsed?.env);

    for (const job of workflow.jobs) {
      if (job.raw.container) {
        continue;
      }
      if (!jobTargetsStandardUbuntuX64(job)) {
        continue;
      }

      const jobEnvText = textify(job.raw.env);
      const jobStepText = job.steps
        .map(
          (step) => `${step.name ?? ""} ${step.uses ?? ""} ${step.run ?? ""} ${textify(step.with)}`,
        )
        .join("\n");
      if (cudaBuildSignalPattern.test(`${workflowEnvText}\n${jobEnvText}\n${jobStepText}`)) {
        continue;
      }

      const packages = new Set<string>();
      let anchor: WorkflowStep | undefined;
      for (const step of job.steps) {
        if (hasCpuInstallIntent(step.run ?? "", jobEnvText, workflowEnvText)) {
          continue;
        }
        const stepPackages = collectTorchPackages(step);
        if (stepPackages.length === 0) {
          continue;
        }
        for (const pkg of stepPackages) {
          packages.add(pkg);
        }
        anchor = anchor ?? step;
      }

      if (packages.size === 0 || !anchor) {
        continue;
      }

      const packageList = [...packages].join(", ");
      findings.push(
        buildDiagnostic(workflow, meta, anchor.runNode ?? anchor.node, {
          message: `Job "${job.id}" installs ${packageList} from the default PyPI build on a standard Ubuntu x64 runner, which pulls the CUDA build and its NVIDIA dependencies.`,
          why: "The default PyPI PyTorch build for Linux x64 bundles CUDA and installs multi-gigabyte NVIDIA packages. A standard Ubuntu x64 runner has no GPU, so that download, disk usage, and install time are paid on every run without being usable.",
          suggestion:
            "Install the CPU-only PyTorch build on CPU runners, for example with `--index-url https://download.pytorch.org/whl/cpu` or a matching CPU index or find-links for the pinned version. A `+cpu` version pin alone is not enough without the CPU index or find-links.",
          measurementHint:
            "Compare dependency install time and cache or image size before and after switching to the CPU-only build on CPU runners.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and confirm it has no CUDA build or GPU runtime need. If it is CPU-only, switch ${packageList} to the CPU-only PyTorch build using a CPU index or find-links that matches the pinned version, and keep unrelated installs unchanged.`,
          score: 48,
        }),
      );
    }

    return findings.slice(0, 3);
  },
};
