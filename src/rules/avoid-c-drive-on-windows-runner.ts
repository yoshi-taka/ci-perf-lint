import { isMap, type Node } from "yaml";
import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { getNode, getScalarString } from "../workflow.ts";
import { jobRunsOnHostedWindows } from "./shared/workflow-jobs.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { stepDisplayName } from "./shared/any-step.ts";

const meta = {
  id: "avoid-c-drive-on-windows-runner",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/avoid-c-drive-on-windows-runner.md",
} satisfies RuleMeta;

function isCDrivePath(value: unknown): boolean {
  const str = getScalarString(value);
  if (!str) {
    return false;
  }
  return /^C:[\\/]/i.test(str);
}

function* findCDriveEnvEntries(envMap: Node): Generator<{ key: string; node: Node }> {
  if (!isMap(envMap)) {
    return;
  }
  for (const item of envMap.items) {
    const key = getScalarString(item.key);
    if (!key) {
      continue;
    }
    if (isCDrivePath(item.value) && item.value && typeof item.value === "object") {
      yield { key, node: item.value as Node };
    }
  }
}

function* findCDrivePathsInJob(job: WorkflowJob): Generator<{ node: Node; message: string }> {
  // job-level env
  const jobEnvNode = getNode(job.node, "env");
  if (jobEnvNode) {
    for (const { key, node } of findCDriveEnvEntries(jobEnvNode)) {
      yield {
        node,
        message: `Job "${job.id}" sets env "${key}" to a C:\\ drive path.`,
      };
    }
  }

  // job-level defaults.run.working-directory
  const defaultsNode = getNode(job.node, "defaults");
  if (defaultsNode && isMap(defaultsNode)) {
    const runNode = getNode(defaultsNode, "run");
    if (runNode && isMap(runNode)) {
      const wdNode = getNode(runNode, "working-directory");
      if (wdNode && isCDrivePath(wdNode)) {
        yield {
          node: wdNode,
          message: `Job "${job.id}" sets defaults.run.working-directory to a C:\\ drive path.`,
        };
      }
    }
  }

  for (const step of job.steps) {
    // step working-directory
    if (step.workingDirectory && isCDrivePath(step.workingDirectory)) {
      yield {
        node: step.workingDirectoryNode ?? step.node,
        message: `Step "${stepDisplayName(step)}" in job "${job.id}" sets working-directory to a C:\\ drive path.`,
      };
    }

    // step-level env
    const stepEnvNode = getNode(step.node, "env");
    if (stepEnvNode) {
      for (const { key, node } of findCDriveEnvEntries(stepEnvNode)) {
        yield {
          node,
          message: `Step "${stepDisplayName(step)}" in job "${job.id}" sets env "${key}" to a C:\\ drive path.`,
        };
      }
    }

    // step with.path
    const withNode = getNode(step.node, "with");
    if (withNode && isMap(withNode)) {
      const pathNode = getNode(withNode, "path");
      if (pathNode && isCDrivePath(pathNode)) {
        yield {
          node: pathNode,
          message: `Step "${stepDisplayName(step)}" in job "${job.id}" passes a C:\\ drive path to the "path" input.`,
        };
      }
    }
  }
}

export const avoidCDriveOnWindowsRunnerRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const diagnostics = [];
    for (const job of workflow.jobs) {
      if (!jobRunsOnHostedWindows(job)) {
        continue;
      }
      for (const { node, message } of findCDrivePathsInJob(job)) {
        diagnostics.push(
          buildDiagnostic(workflow, meta, node, {
            message,
            why: "GitHub-hosted Windows runners provision the OS on a slower C:\\ drive and provide a faster, larger temporary D:\\ drive. Hardcoding C:\\ paths for build outputs, caches, or temporary files increases I/O latency and risks running out of space on the OS disk. Consider using Dev Drive (ReFS with copy-on-write) for even faster build and cache performance.",
            suggestion:
              "Use D:\\ drive paths, runner.temp, or github.workspace for temporary and working data instead of hardcoding C:\\ paths. If available, configure a Dev Drive for build outputs and dependency caches to reduce I/O overhead.",
            measurementHint:
              "Compare job duration and disk I/O before and after moving heavy file operations off C:\\. If you adopt Dev Drive, also measure build and cache restore times against the default NTFS layout.",
            aiHandoff: `Update ${workflow.relativePath} to replace C:\\ drive paths with D:\\, runner.temp, or github.workspace while preserving the intended behavior. Consider configuring a Dev Drive for build outputs and caches if the runner image supports it.`,
            score: 55,
          }),
        );
      }
    }
    return diagnostics;
  },
};
