import path from "node:path";
import type { RuleContext } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import type { CircleCiDocument, CircleCiJob, CircleCiStep } from "../circleci-workflow.ts";
import {
  collectCircleCiWorkflowInvocations,
  type CircleCiWorkflowInvocation,
} from "../circleci-workflow-graph.ts";
import { effectiveInvocationSteps } from "./shared/circleci-effective-steps.ts";
import { expandPackageScriptSegments, packageScriptMap } from "./shared/npm-script-expansion.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "circleci-jest-without-max-workers",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/circleci-jest-without-max-workers.md",
  scope: "circleci",
} satisfies RuleMeta;

const VCPUS: Record<string, number> = {
  small: 1,
  medium: 2,
  "medium+": 3,
  large: 4,
  xlarge: 8,
  "2xlarge": 16,
  "2xlarge+": 20,
  "arm.medium": 2,
  "arm.large": 4,
  "arm.xlarge": 8,
  "arm.2xlarge": 16,
};

const DIRECT_JEST =
  /(?:^|[\s;&|])(?:npx\s+|yarn\s+|pnpm\s+)?jest\b|node_modules\/\.bin\/jest|(?:react-scripts|craco|rescripts)\s+test/i;
const WORKER_FLAG =
  /(?:--maxWorkers\s*[:=]\s*\d+(?![\d%])|-w\s+\d+(?![\d%])|--runInBand|(?:^|\s)-i(?:\s|$))/i;
const PERCENT_WORKER = /(?:\bmaxWorkers\s*[:=]\s*["']?\d+%|--maxWorkers\s*[:=]\s*\d+%)/i;
const UNSUPPORTED_EXECUTOR = /windows|self-hosted|macos|m\dpro/i;

interface WorkerEvidence {
  absolute: boolean;
  percentage: boolean;
  dynamicConfig: boolean;
}

function executorImages(doc: CircleCiDocument, job: CircleCiJob): string[] {
  if (job.dockerImages && job.dockerImages.length > 0) {
    return job.dockerImages;
  }
  const executor = job.executorName ? doc.executors?.get(job.executorName) : undefined;
  return executor?.dockerImages ?? [];
}

function resourceClassOf(job: CircleCiJob): string | undefined {
  return job.resourceClass;
}

function workingDirectoryOf(doc: CircleCiDocument, job: CircleCiJob, step: CircleCiStep): string {
  const executor = job.executorName ? doc.executors?.get(job.executorName) : undefined;
  const raw =
    step.workingDirectory ?? job.workingDirectory ?? executor?.workingDirectory ?? "~/project";
  // CircleCI checks out into the configured working_directory, so `~/...`
  // paths refer to the repository root from the analyzer's point of view.
  if (raw.startsWith("~/") || raw.startsWith("/home/circleci/")) {
    return ".";
  }
  const normalized = raw.replace(/^\.\//, "").replace(/\/+$/, "");
  return normalized === "~" || normalized === "." ? "." : normalized;
}

async function readFileAt(
  context: RuleContext,
  directory: string,
  fileName: string,
): Promise<string | undefined> {
  const scanContext = context.scanContext;
  if (!scanContext) {
    return undefined;
  }
  const relative = directory === "." ? fileName : path.posix.join(directory, fileName);
  const filePath = scanContext.resolve(relative);
  if (!(await scanContext.pathExists(filePath))) {
    return undefined;
  }
  return (await scanContext.readTextFileOrWarn(filePath)) ?? undefined;
}

function configWorkerEvidence(text: string): WorkerEvidence {
  const absolute = /(?:^|[\s,{(])maxWorkers\s*:\s*\d+(?:\s*[,}\n]|$)/m.test(text);
  const percentage = PERCENT_WORKER.test(text);
  const dynamic = /\brequire\s*\(|\bprocess\.env\b|\bimport\s|=>.*maxWorkers|function\s/.test(text);
  return { absolute, percentage, dynamicConfig: dynamic };
}

async function collectWorkerEvidence(
  context: RuleContext,
  command: string,
  directory: string,
  repoRoot: string,
): Promise<WorkerEvidence> {
  let absolute = WORKER_FLAG.test(command);
  let percentage = PERCENT_WORKER.test(command);
  let dynamicConfig = false;

  const configTarget = /--config\s+(\S+)/.exec(command)?.[1];
  const configFiles = [
    ...(configTarget ? [configTarget] : []),
    "jest.config.js",
    "jest.config.cjs",
    "jest.config.mjs",
    "jest.config.ts",
    "jest.config.json",
  ];
  for (const configFile of configFiles) {
    const candidates = configFile.startsWith("/")
      ? [configFile]
      : [path.posix.join(directory, configFile), configFile];
    for (const candidate of [...new Set(candidates)]) {
      const text = await readFileAt(context, ".", candidate.replace(/^\.\//, ""));
      if (text === undefined) {
        continue;
      }
      const evidence = configWorkerEvidence(text);
      absolute ||= evidence.absolute;
      percentage ||= evidence.percentage;
      dynamicConfig ||= evidence.dynamicConfig;
    }
  }

  for (const packagePath of [
    directory === "." ? "package.json" : path.posix.join(directory, "package.json"),
  ]) {
    const text = await readFileAt(context, ".", packagePath);
    if (!text) {
      continue;
    }
    let packageJson: Record<string, unknown>;
    try {
      packageJson = JSON.parse(text) as Record<string, unknown>;
    } catch {
      dynamicConfig = true;
      continue;
    }
    const normalizedCommand = command.replace(/\bnpm\s+test\b/gi, "npm run test");
    const expanded = expandPackageScriptSegments(normalizedCommand, packageScriptMap(packageJson));
    absolute ||= expanded.some((segment) => WORKER_FLAG.test(segment));
    percentage ||= expanded.some((segment) => PERCENT_WORKER.test(segment));
    const jest = packageJson.jest;
    if (jest && typeof jest === "object" && !Array.isArray(jest)) {
      const maxWorkers = (jest as Record<string, unknown>).maxWorkers;
      if (typeof maxWorkers === "number") {
        absolute = true;
      } else if (typeof maxWorkers === "string" && /^\d+%$/.test(maxWorkers)) {
        percentage = true;
      }
    }
  }

  void repoRoot;
  return { absolute, percentage, dynamicConfig };
}

async function jestIsIndirect(
  context: RuleContext,
  command: string,
  directory: string,
): Promise<boolean> {
  if (!/\bnpm\s+(?:test|run(?:-script)?)\b|\b(?:yarn|pnpm)\s+[A-Za-z][\w:-]*/i.test(command)) {
    return false;
  }
  const packagePath =
    directory === "." ? "package.json" : path.posix.join(directory, "package.json");
  const text = await readFileAt(context, ".", packagePath);
  if (!text) {
    return false;
  }
  try {
    const packageJson = JSON.parse(text) as Record<string, unknown>;
    const normalized = command.replace(/\bnpm\s+test\b/gi, "npm run test");
    return expandPackageScriptSegments(normalized, packageScriptMap(packageJson)).some((segment) =>
      DIRECT_JEST.test(segment),
    );
  } catch {
    return false;
  }
}

export const circleciJestWithoutMaxWorkersRule = {
  meta,
  async check(doc: CircleCiDocument, context: RuleContext) {
    const jobsByName = new Map(doc.jobs.map((job) => [job.name, job]));
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    const workflowInvocations = collectCircleCiWorkflowInvocations(doc);
    const invokedJobs = new Set(workflowInvocations.map((invocation) => invocation.jobName));
    const invocations: CircleCiWorkflowInvocation[] = [...workflowInvocations];
    for (const job of doc.jobs) {
      if (invokedJobs.has(job.name)) {
        continue;
      }
      invocations.push({
        workflowName: "(default)",
        jobName: job.name,
        alias: job.name,
        requires: [],
        filters: {},
        matrix: false,
        parameters: new Map<string, string>(),
        uncertain: false,
        node: job.node,
      });
    }

    for (const invocation of invocations) {
      if (invocation.matrix || invocation.overrideWith) {
        continue;
      }
      const job = jobsByName.get(invocation.jobName);
      if (!job) {
        continue;
      }
      if (executorImages(doc, job).length === 0) {
        continue;
      }
      const resourceClass = resourceClassOf(job);
      if (resourceClass && UNSUPPORTED_EXECUTOR.test(resourceClass)) {
        continue;
      }
      const steps = effectiveInvocationSteps(doc, job, invocation);
      if (!steps) {
        continue;
      }
      // A worker flag added in pre/post steps applies to this invocation only.
      if (
        steps.some(
          (candidate) => candidate.type === "run" && WORKER_FLAG.test(candidate.command ?? ""),
        )
      ) {
        continue;
      }
      for (const step of steps) {
        if (step.type !== "run" || !step.command) {
          continue;
        }
        const workDir = workingDirectoryOf(doc, job, step);
        const indirect = await jestIsIndirect(context, step.command, workDir);
        if (!DIRECT_JEST.test(step.command) && !indirect) {
          continue;
        }
        const evidence = await collectWorkerEvidence(context, step.command, workDir, ".");
        if (evidence.absolute) {
          continue;
        }
        const cpuCount = resourceClass ? VCPUS[resourceClass] : VCPUS.medium;
        const workerText =
          cpuCount === undefined ? "the resource class vCPU count" : String(cpuCount);
        const percentageNote = evidence.percentage
          ? " The configured percentage is computed from the host VM's CPUs, not the container's."
          : "";
        const confidence =
          evidence.percentage || evidence.dynamicConfig || indirect ? "medium" : "high";
        findings.push(
          buildDiagnostic(doc, meta, step.commandNode ?? step.node, {
            confidence,
            message: `Job "${invocation.alias}" runs Jest on the Docker executor${resourceClass ? ` (${resourceClass}, ${cpuCount ?? "the resource class"} vCPU)` : ""} without a worker limit; Jest sizes its worker pool from the host VM's CPUs, not the container's.${percentageNote}`,
            why: "Jest defaults to the CPU count of the VM, which can exceed the container's allocated vCPUs and cause CPU and memory oversubscription.",
            suggestion: `Add --maxWorkers=${workerText} to the Jest command, or set maxWorkers: ${cpuCount ?? "<vCPU count>"} in the Jest config. Use --runInBand only for very small classes such as small (1 vCPU).`,
            measurementHint:
              "Compare Jest wall-clock time and peak memory before and after setting the worker count.",
            aiHandoff: `Review ${doc.relativePath} invocation "${invocation.alias}" and pin Jest workers to ${workerText}; verify the suite still passes and peak memory drops.`,
            score: confidence === "high" ? 56 : 48,
          }),
        );
        break;
      }
    }
    return findings;
  },
};
