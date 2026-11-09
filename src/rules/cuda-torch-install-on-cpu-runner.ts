import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobRunsOnStandardX64Ubuntu } from "./shared/runs-on-facts.ts";
import { effectiveStepEnvironment } from "./shared/workflow-env.ts";
import { dependencyInstallCommands } from "./shared/dependency-install-evidence.ts";
import { toolInvocations } from "./shared/tool-command-evidence.ts";
import {
  declaredShellEnvironmentNames,
  githubEnvironmentValues,
} from "./shared/shell-environment-evidence.ts";

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

function environmentHasCudaIntent(env: Record<string, unknown>): boolean {
  return (
    Object.keys(env).some((name) =>
      /^(?:TORCH_CUDA_ARCH_LIST|CUDA_HOME|CUDA_PATH|CUDA_COMPUTE_CAP|LIBTORCH_USE_PYTORCH)$/.test(
        name,
      ),
    ) ||
    [env.PIP_INDEX_URL, env.PIP_EXTRA_INDEX_URL].some(
      (value) => typeof value === "string" && /\/whl\/cu\d/i.test(value),
    ) ||
    (typeof env.UV_TORCH_BACKEND === "string" && /^cu\d+/.test(env.UV_TORCH_BACKEND))
  );
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

function collectTorchPackages(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
  persisted: Record<string, string>,
): string[] {
  if (!step.run || stepIfExcludesLinux(step)) {
    return [];
  }

  const packages = new Set<string>();
  for (const command of dependencyInstallCommands(step.run, {
    ...persisted,
    ...effectiveStepEnvironment(workflow, job, step),
  })) {
    if (!command.python) {
      continue;
    }
    const { options, environment } = command;
    if (
      options.some(
        ({ name, value }) =>
          ["--index-url", "--extra-index-url", "--find-links", "-f", "--torch-backend"].includes(
            name,
          ) && /[$`]|__shell_substitution__/.test(value ?? ""),
      ) ||
      [
        environment.UV_TORCH_BACKEND,
        environment.PIP_INDEX_URL,
        environment.PIP_EXTRA_INDEX_URL,
      ].some((value) => typeof value === "string" && /[$`]|__shell_substitution__/.test(value))
    ) {
      continue;
    }
    if (
      options.some(
        ({ name, value }) =>
          (["--index-url", "--extra-index-url", "--find-links", "-f"].includes(name) &&
            /\/whl\/cpu|\/cpu\b/i.test(value ?? "")) ||
          (name === "--torch-backend" && ["cpu", "auto"].includes(value ?? "")),
      ) ||
      (typeof environment.UV_TORCH_BACKEND === "string" &&
        ["cpu", "auto"].includes(environment.UV_TORCH_BACKEND)) ||
      [environment.PIP_INDEX_URL, environment.PIP_EXTRA_INDEX_URL].some(
        (value) => typeof value === "string" && /\/whl\/cpu/i.test(value),
      )
    ) {
      continue;
    }
    for (const token of command.packages) {
      const name = /^(torch(?:vision|audio)?)(?=$|[<>=!~[])/i.exec(token)?.[1];
      if (name && !/\+cpu\b/i.test(token)) {
        packages.add(name.toLowerCase());
      }
    }
  }
  return [...packages];
}

export const cudaTorchInstallOnCpuRunnerRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.raw.container) {
        continue;
      }
      if (!jobTargetsStandardUbuntuX64(job)) {
        continue;
      }

      const cudaEnvironment: Record<string, string> = {};
      const hasCudaWork = job.steps.some((step) => {
        const environment = {
          ...cudaEnvironment,
          ...effectiveStepEnvironment(workflow, job, step),
        };
        const hasIntent =
          cudaBuildSignalPattern.test(step.uses ?? "") ||
          environmentHasCudaIntent(environment) ||
          [...declaredShellEnvironmentNames(step.run ?? "")].some((name) =>
            cudaBuildSignalPattern.test(name),
          ) ||
          toolInvocations(step.run ?? "").some(([tool]) => tool === "nvcc") ||
          dependencyInstallCommands(step.run ?? "", environment).some(
            (command) =>
              environmentHasCudaIntent(command.environment) ||
              command.packages.some((pkg) => pkg.includes("and-cuda")) ||
              command.options.some(
                ({ name, value }) =>
                  ["--index-url", "--extra-index-url", "--find-links", "-f"].includes(name) &&
                  /\/whl\/cu\d/i.test(value ?? ""),
              ),
          );
        Object.assign(cudaEnvironment, githubEnvironmentValues(step.run ?? ""));
        return hasIntent;
      });
      if (hasCudaWork) {
        continue;
      }

      const packages = new Set<string>();
      const persisted: Record<string, string> = {};
      let anchor: WorkflowStep | undefined;
      for (const step of job.steps) {
        const stepPackages = collectTorchPackages(workflow, job, step, persisted);
        Object.assign(persisted, githubEnvironmentValues(step.run ?? ""));
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
