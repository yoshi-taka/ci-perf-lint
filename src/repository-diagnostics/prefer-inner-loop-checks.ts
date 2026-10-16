import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "../rules/shared/diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { collectInnerLoopEvidence } from "./inner-loop-evidence.ts";
import { collectInnerLoopActivity } from "./inner-loop-activity.ts";

const meta = {
  id: "prefer-inner-loop-checks",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-inner-loop-checks.md",
} satisfies RuleMeta;

const setupAction =
  /^actions\/(?:checkout|setup-node|setup-python|setup-go|cache)(?:\/|@)|^(?:oven-sh\/setup-bun|pnpm\/action-setup|astral-sh\/setup-uv|dtolnay\/rust-toolchain)@/;
const install = /^(?:(?:npm|pnpm|yarn|bun) (?:ci|install)(?:\s|$)|uv sync(?:\s|$))/;
const directCheck =
  /^(?:(?:npx|bunx|pnpm exec|yarn exec|uv run)\s+)?(?:eslint|oxlint|prettier|oxfmt|biome (?:check|format|lint)|ruff (?:check|format)|black|isort|cargo (?:fmt|clippy)|gofmt|golangci-lint run)(?:\s|$)/;
const scriptCall = /^(?:npm run|pnpm(?: run)?|yarn(?: run)?|bun run)\s+([\w:.-]+)$/;

function isCheck(
  text: string,
  scripts: Record<string, unknown>,
  seen = new Set<string>(),
): boolean {
  if (/[`$|;&<>\\\n]/.test(text)) {
    return false;
  }
  if (directCheck.test(text)) {
    return true;
  }
  const name = scriptCall.exec(text)?.[1];
  if (!name || seen.has(name) || typeof scripts[name] !== "string") {
    return false;
  }
  if (scripts[`pre${name}`] || scripts[`post${name}`]) {
    return false;
  }
  seen.add(name);
  return isCheck(scripts[name], scripts, seen);
}

function checkOnlyJob(job: WorkflowJob, scripts: Record<string, unknown>): boolean {
  if (
    job.usesReusableWorkflow ||
    job.raw.services ||
    job.hasIf ||
    job.raw.strategy ||
    job.steps.length === 0
  ) {
    return false;
  }
  let checks = 0;
  for (const step of job.steps) {
    if (step.workingDirectory || step.if) {
      return false;
    }
    if (step.uses) {
      if (!setupAction.test(step.uses)) {
        return false;
      }
      continue;
    }
    if (!step.run) {
      return false;
    }
    for (const line of step.run
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean)) {
      if (isCheck(line, scripts)) {
        checks++;
      } else if (!install.test(line) || /[;&|<>`$]/.test(line)) {
        return false;
      }
    }
  }
  return checks > 0;
}

export async function collectPreferInnerLoopChecksDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  if (context.repositoryVisibility === "public") {
    return [];
  }
  const evidence = await collectInnerLoopEvidence(context.scanContext);
  if (evidence.length === 0) {
    return [];
  }
  const pkg = await context.scanContext.loadPackageJson();
  const scripts = pkg.value?.scripts;
  const scriptMap =
    scripts && typeof scripts === "object" && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)
      : {};
  const diagnostics: Diagnostic[] = [];
  const candidates = new Map<string, { id: string; job: WorkflowJob }[]>();
  for (const workflow of context.workflows) {
    if (workflow.parsed?.defaults) {
      continue;
    }
    const jobs = workflow.jobs.filter((job) => !job.raw.defaults && checkOnlyJob(job, scriptMap));
    if (jobs.length > 0) {
      candidates.set(
        workflow.relativePath,
        jobs.map((job) => ({ id: `${workflow.relativePath}#${job.id}`, job })),
      );
    }
  }
  const activity = await collectInnerLoopActivity(context.repoRoot, candidates, {
    declaredVisibility: context.repositoryVisibility,
  });
  for (const workflow of context.workflows) {
    if (workflow.parsed?.defaults) {
      continue;
    }
    for (const job of workflow.jobs) {
      const observed = activity.get(`${workflow.relativePath}#${job.id}`);
      if (!observed) {
        continue;
      }
      diagnostics.push(
        buildDiagnostic(workflow, meta, job.idNode, {
          message: `Job "${job.id}" runs only lint/format checks and setup in a verified private repository with agent validation policy and automation (${evidence.join(", ")}). Over the last five complete weekdays (${observed.timeZone}): ${observed.lowerBound ? "at least " : ""}${observed.runsPerWeekday.toFixed(1)} repository workflow runs/day across ${observed.lowerBound ? "at least " : ""}${observed.activeDays} active days; recognized setup ${observed.setupSeconds.toFixed(0)}s (single job observation, not a median).`,
          why: "A dedicated check job pays runner/container startup, checkout, and dependency setup costs even when fast checks can run inside the agent's development loop.",
          suggestion:
            "Consider moving lint/format checks exclusively to the agent inner loop and retiring the dedicated CI job after verifying enforcement and contributor trust. Formatting is the lowest-risk starting point; keep CI checks where independent validation is required.",
          measurementHint:
            "Compare total runner minutes and startup/setup time before and after consolidation; monitor escaped lint/format failures and verify required-check and contributor policies.",
          aiHandoff: `Review ${workflow.relativePath} job ${job.id} against ${evidence.join(", ")}. Confirm equivalent checks actually run before submission for every contributor. Only retire the dedicated job with approval; preserve security checks, tests, required checks, and dependent jobs. Do not assume agent instructions guarantee execution.`,
          score: 35,
        }),
      );
    }
  }
  return diagnostics;
}
