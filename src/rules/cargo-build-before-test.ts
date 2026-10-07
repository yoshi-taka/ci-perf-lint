import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { staticShellWords } from "./shared/command-patterns.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "cargo-build-before-test",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/cargo-build-before-test.md",
} satisfies RuleMeta;

function cargoConditions(step: WorkflowStep, verb: "build" | "test"): string | undefined {
  const words = staticShellWords(step.run?.trim() ?? "");
  if (words?.[0] !== "cargo" || words[1] !== verb) {
    return undefined;
  }
  const flags: string[] = [];
  let profile = "dev";
  const valueFlags = new Set([
    "--features",
    "-F",
    "--target",
    "--package",
    "-p",
    "--manifest-path",
    "--profile",
    "--bin",
    "--example",
    "--test",
    "--bench",
    "--exclude",
  ]);
  const aliases: Record<string, string> = {
    "-F": "--features",
    "-p": "--package",
    "-w": "--workspace",
  };
  const switches = new Set([
    "--all-features",
    "--no-default-features",
    "--workspace",
    "-w",
    "--bins",
    "--lib",
    "--tests",
    "--examples",
    "--benches",
    "--all-targets",
    "--locked",
    "--frozen",
    "--offline",
  ]);
  for (let i = 2; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--" && verb === "test") {
      break;
    }
    if (word === "--no-run") {
      return undefined;
    }
    if (word === "--release" || word === "-r") {
      profile = "release";
      continue;
    }
    if (word === "--quiet" || word === "-q" || /^-v+$/.test(word) || word === "--verbose") {
      continue;
    }
    const equal = word.indexOf("=");
    const key = equal === -1 ? word : word.slice(0, equal);
    if (valueFlags.has(key)) {
      const value = equal === -1 ? words[++i] : word.slice(equal + 1);
      if (!value || value.startsWith("-")) {
        return undefined;
      }
      if (key === "--profile") {
        profile = value;
      } else {
        flags.push(
          `${aliases[key] ?? key}=${key === "--features" || key === "-F" ? value.split(/[ ,]+/).sort().join(",") : value}`,
        );
      }
    } else if (switches.has(word)) {
      flags.push(aliases[word] ?? word);
    } else {
      // Unknown flags may alter compilation; do not silently equate them with defaults.
      return undefined;
    }
  }
  return JSON.stringify([profile, flags.sort()]);
}

function sameExecutionContext(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  a: WorkflowStep,
  b: WorkflowStep,
): boolean {
  const aDir = workflowWorkingDirectory(workflow, job, a);
  const bDir = workflowWorkingDirectory(workflow, job, b);
  if (aDir.includes("${{") || bDir.includes("${{")) {
    return false;
  }
  const env = (step: WorkflowStep) =>
    JSON.stringify(
      Object.entries(workflowStepEnv(workflow, job, step)).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  return (
    path.posix.normalize(aDir) === path.posix.normalize(bDir) && env(a) === env(b) && a.if === b.if
  );
}

function findRedundantBuildBeforeTest(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): WorkflowStep | undefined {
  for (let i = 0; i < job.steps.length; i++) {
    const build = job.steps[i]!;
    const config = cargoConditions(build, "build");
    if (config === undefined) {
      continue;
    }
    for (let j = i + 1; j <= i + 3 && j < job.steps.length; j++) {
      const test = job.steps[j]!;
      if (
        cargoConditions(test, "test") === config &&
        sameExecutionContext(workflow, job, build, test)
      ) {
        return build;
      }
    }
  }
  return undefined;
}

export const cargoBuildBeforeTestRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }
      const build = findRedundantBuildBeforeTest(workflow, job);
      if (!build) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, build.runNode ?? build.node, {
          message: `Job "${job.id}" runs \`cargo build\` shortly before \`cargo test\` with identical build conditions.`,
          why: "`cargo test` compiles the required targets automatically. A preceding `cargo build` with the same profile, target, features, and package scope is usually redundant.",
          suggestion:
            "Remove the `cargo build` step, or use `cargo test --no-run` if you need an explicit compile phase.",
          measurementHint:
            "Compare job runtime with and without the `cargo build` step while keeping the `cargo test` step.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}; remove the redundant \`cargo build\` step before \`cargo test\` if it has no separate required output.`,
          score: 62,
        }),
      );
    }
    return findings;
  },
};
