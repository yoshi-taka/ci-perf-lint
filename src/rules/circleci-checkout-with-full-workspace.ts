import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CircleCiDocument, CircleCiJob, CircleCiStep } from "../circleci-workflow.ts";
import {
  collectCircleCiWorkflowInvocations,
  type CircleCiWorkflowInvocation,
} from "../circleci-workflow-graph.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "circleci-checkout-with-full-workspace",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/circleci-checkout-with-full-workspace.md",
  scope: "circleci",
} satisfies RuleMeta;

const DEFAULT_PROJECT_DIR = "/home/circleci/project";
const WHOLE_PROJECT_PATHS = new Set([".", "./", "*", "./*"]);
const GIT_REMOTE_COMMAND = /\bgit\s+(?:push|fetch|pull|ls-remote)\b|\bgit\s+tag\b[^\n]*\bpush\b/i;
const RELEASE_TOOL_COMMAND =
  /\b(?:semantic-release|release-it|changesets?|lerna\s+(?:publish|version)|standard-version|goreleaser)\b/i;

function normalizePath(value: string | undefined, base: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  let text = value.trim().replace(/^['"]|['"]$/g, "");
  if (!text) {
    return undefined;
  }
  if (text === "~") {
    text = "/home/circleci";
  } else if (text.startsWith("~/")) {
    text = `/home/circleci/${text.slice(2)}`;
  } else if (!text.startsWith("/")) {
    text = path.posix.join(base, text);
  }
  const normalized = path.posix.normalize(text).replace(/\/+$/, "");
  return normalized || "/";
}

function jobWorkingDirectory(doc: CircleCiDocument, job: CircleCiJob): string {
  const executorDirectory = job.executorName
    ? doc.executors?.get(job.executorName)?.workingDirectory
    : undefined;
  return (
    normalizePath(job.workingDirectory ?? executorDirectory ?? "~/project", DEFAULT_PROJECT_DIR) ??
    DEFAULT_PROJECT_DIR
  );
}

function checkoutPath(job: CircleCiJob, workingDirectory: string): string | undefined {
  const step = job.steps.find((candidate) => candidate.type === "checkout");
  if (!step) {
    return undefined;
  }
  return normalizePath(step.checkoutPath ?? workingDirectory, workingDirectory);
}

function attachAt(step: CircleCiStep, workingDirectory: string): string | undefined {
  return normalizePath(step.attachAt ?? workingDirectory, workingDirectory);
}

function persistsWholeProject(
  doc: CircleCiDocument,
  job: CircleCiJob,
): { root: string; paths: string[] } | undefined {
  const workingDirectory = jobWorkingDirectory(doc, job);
  for (const step of job.steps) {
    if (step.type !== "persist_to_workspace") {
      continue;
    }
    const paths = step.workspacePaths ?? [];
    if (!paths.some((candidate) => WHOLE_PROJECT_PATHS.has(candidate.trim()))) {
      continue;
    }
    const root = normalizePath(step.workspaceRoot, workingDirectory);
    if (root) {
      return { root, paths };
    }
  }
  return undefined;
}

function needsCheckoutForRelease(job: CircleCiJob): boolean {
  return job.steps.some((step) => {
    if (step.type === "add_ssh_keys") {
      // The SSH key and known_hosts are needed by release tools that push tags.
      return true;
    }
    return (
      step.type === "run" &&
      (GIT_REMOTE_COMMAND.test(step.command ?? "") || RELEASE_TOOL_COMMAND.test(step.command ?? ""))
    );
  });
}

function reachableUpstreams(
  invocation: CircleCiWorkflowInvocation,
  invocations: readonly CircleCiWorkflowInvocation[],
): CircleCiWorkflowInvocation[] {
  const byAlias = new Map(
    invocations
      .filter((candidate) => candidate.workflowName === invocation.workflowName)
      .map((candidate) => [candidate.alias, candidate]),
  );
  const result: CircleCiWorkflowInvocation[] = [];
  const seen = new Set<string>();
  const queue = [...invocation.requires];
  while (queue.length > 0) {
    const alias = queue.shift()!;
    if (seen.has(alias)) {
      continue;
    }
    seen.add(alias);
    const upstream = byAlias.get(alias);
    if (!upstream) {
      continue;
    }
    result.push(upstream);
    queue.push(...upstream.requires);
  }
  return result;
}

export const circleciCheckoutWithFullWorkspaceRule = {
  meta,
  check(doc: CircleCiDocument, _context: RuleContext): Diagnostic[] {
    const jobsByName = new Map(doc.jobs.map((job) => [job.name, job]));
    const invocations = collectCircleCiWorkflowInvocations(doc);
    const findings: Diagnostic[] = [];

    for (const invocation of invocations) {
      const job = jobsByName.get(invocation.jobName);
      if (!job) {
        continue;
      }
      const workingDirectory = jobWorkingDirectory(doc, job);
      const checkedOut = checkoutPath(job, workingDirectory);
      if (!checkedOut) {
        continue;
      }
      const attachSteps = job.steps.filter((step) => step.type === "attach_workspace");
      if (attachSteps.length === 0 || needsCheckoutForRelease(job)) {
        continue;
      }

      for (const attachStep of attachSteps) {
        const destination = attachAt(attachStep, workingDirectory);
        if (destination !== checkedOut) {
          continue;
        }

        for (const upstreamInvocation of reachableUpstreams(invocation, invocations)) {
          const upstreamJob = jobsByName.get(upstreamInvocation.jobName);
          if (!upstreamJob) {
            continue;
          }
          const persisted = persistsWholeProject(doc, upstreamJob);
          if (!persisted || persisted.root !== destination) {
            continue;
          }

          const upstream = upstreamInvocation.alias;
          findings.push(
            buildDiagnostic(doc, meta, attachStep.invocationNode ?? attachStep.node, {
              message: `Job "${invocation.alias}" checks out the repository and then attaches a workspace that already contains the whole project from job "${upstream}".`,
              why: "The workspace already contains the checked-out project, so running checkout in the downstream job transfers the source twice and increases workspace restore time.",
              suggestion: `Remove checkout from "${invocation.alias}", or narrow persist_to_workspace.paths in "${upstream}" to the build outputs the downstream job needs. Narrowing is preferred when the workspace includes dependency directories such as node_modules, .venv, or vendor.`,
              measurementHint:
                'Compare "Attaching Workspace" and "Checkout code" step times and the workspace size shown in the upstream job.',
              aiHandoff: `Review ${doc.relativePath}. The workspace from "${upstream}" already contains the whole project at ${destination}. Remove checkout from "${invocation.alias}" or narrow the persisted paths to the outputs it needs; verify the downstream job still has every required file.`,
              score: 68,
            }),
          );
          break;
        }
      }
    }
    return findings;
  },
};
