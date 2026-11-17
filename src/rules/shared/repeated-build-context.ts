import path from "node:path";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { getNode } from "../../workflow.ts";
import { detectBuildTool } from "./tools.ts";
import { effectiveStepEnvironment } from "./workflow-env.ts";
import { workflowHasUnmodeledShell, workflowWorkingDirectory } from "./workflow-command-context.ts";
import { getRunsOnSpec } from "./runs-on-facts.ts";

// Unknown expressions are not evidence of identical inputs, even when their
// spelling matches (matrix/env/steps contexts may resolve differently per job).
function literalKey(value: unknown, depth = 0): string | undefined {
  if (depth > 32) {
    return undefined;
  }
  if (value == null) {
    return "null";
  }
  if (typeof value === "string") {
    return /\$|`/.test(value) ? undefined : JSON.stringify(value);
  }
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const entries = Array.isArray(value)
    ? value.map((entry) => literalKey(entry, depth + 1))
    : Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => {
          const encoded = literalKey(entry, depth + 1);
          return encoded === undefined ? undefined : `${JSON.stringify(key)}:${encoded}`;
        });
  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }
  return Array.isArray(value) ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
}

function unconditional(value: unknown): boolean {
  if (value === undefined || value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const condition = value
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
    .trim()
    .toLowerCase();
  return ["true", "success()", "always()"].includes(condition);
}

function runDefaults(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const defaults = raw?.defaults as { run?: Record<string, unknown> } | undefined;
  return defaults?.run ?? {};
}

function runContext(workflow: WorkflowDocument, job: WorkflowJob, step: WorkflowStep) {
  if (workflowHasUnmodeledShell(workflow, job, step)) {
    return undefined;
  }
  return literalKey({
    run: step.run?.trim(),
    directory: workflowWorkingDirectory(workflow, job, step),
    shell:
      getNode(step.node, "shell")?.toJSON() ??
      runDefaults(job.raw).shell ??
      runDefaults(workflow.parsed).shell ??
      "default",
    env: effectiveStepEnvironment(workflow, job, step),
  });
}

function isDependencyCache(step: WorkflowStep): boolean {
  if (!/^actions\/cache(?:\/(?:restore|save))?@/.test(step.uses ?? "")) {
    return false;
  }
  const paths = step.with?.path;
  // Only dependency/compiler caches outside the checkout can be ignored.
  // A cache of source files or build artifacts may change the build inputs.
  return (
    typeof paths === "string" &&
    paths
      .trim()
      .split(/\r?\n/)
      .every((entry) =>
        /^(?:~\/\.npm|~\/\.cache\/(?:pip|go-build)|~\/go\/pkg\/mod)\/?$/.test(entry.trim()),
      )
  );
}

const setupAction =
  /^(?:actions\/setup-(?:node|python|go|java|dotnet)|oven-sh\/setup-bun|pnpm\/action-setup|ruby\/setup-ruby)@/;

interface ComparableBuild {
  key: string;
  tool: string;
  step: WorkflowStep;
}

/** Visible input identity, not proof that arbitrary build scripts are equivalent. */
export function comparableBuilds(workflow: WorkflowDocument, job: WorkflowJob): ComparableBuild[] {
  if (!unconditional(job.raw.if) || !getRunsOnSpec(job).isStandardHosted) {
    return [];
  }
  const context = literalKey({
    runner: job.raw["runs-on"],
    container: job.raw.container,
    services: job.raw.services,
    needs: job.raw.needs,
    permissions: job.raw.permissions,
    environment: job.raw.environment,
  });
  if (context === undefined) {
    return [];
  }

  const builds: ComparableBuild[] = [];
  const prefix: string[] = [];
  let checkoutPath: string | undefined;
  for (const step of job.steps) {
    if (isDependencyCache(step)) {
      continue;
    }
    if (!unconditional(getNode(step.node, "if")?.toJSON())) {
      break;
    }
    if (step.uses) {
      const checkout = /^actions\/checkout@/.test(step.uses);
      if (!checkout && !setupAction.test(step.uses)) {
        break;
      }
      if (checkout) {
        // Multiple checkouts can supply unrelated trees or overwrite each other.
        if (checkoutPath !== undefined) {
          break;
        }
        const directory = step.with?.path ?? ".";
        if (typeof directory !== "string") {
          break;
        }
        checkoutPath = directory;
      }
      const inputs = { ...step.with };
      if (!checkout) {
        // Built-in dependency-cache policy does not select a different runtime.
        delete inputs.cache;
        delete inputs["cache-dependency-path"];
        delete inputs["package-manager-cache"];
      }
      const setup = literalKey({
        uses: step.uses,
        inputs,
        env: effectiveStepEnvironment(workflow, job, step),
      });
      if (setup === undefined) {
        break;
      }
      prefix.push(setup);
      continue;
    }
    if (step.run === undefined) {
      break;
    }
    const run = runContext(workflow, job, step);
    if (run === undefined) {
      break;
    }
    const tool = detectBuildTool(step);
    const directory = workflowWorkingDirectory(workflow, job, step);
    const insideCheckout =
      checkoutPath !== undefined &&
      !path.posix.isAbsolute(directory) &&
      !directory.split("/").includes("..") &&
      (checkoutPath === "." ||
        directory === checkoutPath ||
        directory.startsWith(`${checkoutPath}/`));
    if (tool && insideCheckout) {
      builds.push({ key: JSON.stringify([context, prefix, run]), tool, step });
    }
    // Earlier commands may patch sources, install tools, or generate files.
    prefix.push(run);
  }
  return builds;
}
