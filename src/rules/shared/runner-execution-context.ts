import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getMapValue } from "../../workflow.ts";
import { hasShellInputDocument } from "./command-patterns.ts";
import { shellInvocations } from "./shell-invocations.ts";

// This is a bounded source-level check, not proof of what a CLI's hooks execute.
// Unknown scripts, actions and dispatchers must not establish job-wide portability.
const visibleCommands = new Set([
  "echo",
  "printf",
  "test",
  "true",
  "false",
  "set",
  "cd",
  "pwd",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "chmod",
  "touch",
  "cat",
  "ls",
  "git",
  "curl",
  "wget",
  "jq",
  "oxlint",
  "oxfmt",
  "ruff",
  "biome",
  "@biomejs/biome",
  "actionlint",
  "shellcheck",
  "yamllint",
  "markdownlint",
  "markdownlint-cli",
  "markdownlint-cli2",
  "cspell",
  "terraform",
  "cdk",
  "aws-cdk",
  "pulumi",
  "aws",
  "sam",
  "serverless",
  "sls",
  "sst",
  "kubectl",
  "helm",
  "cargo",
  "go",
  "docker",
  "mvn",
  "gradle",
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "pytest",
  "tsc",
]);
const setupActions = new Set([
  "actions/checkout",
  "actions/setup-node",
  "actions/setup-python",
  "actions/setup-go",
  "actions/setup-java",
  "actions/cache",
  "actions/cache/restore",
  "actions/cache/save",
  "actions/upload-artifact",
  "actions/download-artifact",
  "astral-sh/setup-uv",
  "oven-sh/setup-bun",
  "pnpm/action-setup",
  "hashicorp/setup-terraform",
]);

export function stepHasKnownRunnerShell(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): boolean {
  const defaultShell = (defaults: Record<string, unknown> | undefined): unknown => {
    const run = defaults?.run;
    return run && typeof run === "object" && "shell" in run ? run.shell : undefined;
  };
  const shell =
    step.node.get("shell") ??
    defaultShell(getMapValue(job.node, "defaults")) ??
    defaultShell(workflow.root ? getMapValue(workflow.root, "defaults") : undefined);
  return (
    shell === undefined ||
    shell === "bash" ||
    shell === "sh" ||
    shell === "bash --noprofile --norc -e -o pipefail {0}" ||
    shell === "bash -l {0}"
  );
}

export function jobHasUnresolvedRunnerExecution(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): boolean {
  return job.steps.some((step) => {
    if (step.uses && !setupActions.has(step.uses.split("@")[0]!.toLowerCase())) {
      return true;
    }
    if (!step.run) {
      return false;
    }
    if (
      !stepHasKnownRunnerShell(workflow, job, step) ||
      hasShellInputDocument(step.run) ||
      /\$\(|`/.test(step.run)
    ) {
      return true;
    }
    return shellInvocations(step.run).some(([tool, action]) => {
      if (
        (tool === "docker" && !["build", "--version"].includes(action ?? "")) ||
        (tool === "kubectl" && ["exec", "run", "debug"].includes(action ?? "")) ||
        (tool === "cargo" &&
          !["build", "test", "check", "fmt", "clippy", "--version"].includes(action ?? "")) ||
        (tool === "go" && !["build", "test", "fmt", "vet", "version"].includes(action ?? ""))
      ) {
        return true;
      }
      if (["npm", "pnpm", "yarn", "bun", "pip", "pip3", "uv"].includes(tool ?? "")) {
        return !["ci", "install", "add", "sync", "--version"].includes(action ?? "");
      }
      return !visibleCommands.has(tool ?? "");
    });
  });
}
