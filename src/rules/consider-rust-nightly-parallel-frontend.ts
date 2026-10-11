import path from "node:path";
import type { RuleContext } from "../rule-engine.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "consider-rust-nightly-parallel-frontend",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-rust-nightly-parallel-frontend.md",
} satisfies RuleMeta;

function isNightly(toolchain: string | undefined): boolean {
  return /^nightly(?:-\d{4}-\d{2}-\d{2})?(?:-(?:x86_64|aarch64|i686)-[\w-]+)?$/.test(
    toolchain ?? "",
  );
}

function resolveToolchain(value: unknown, env: Record<string, unknown>): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const key = value.match(/^\$\{\{\s*env\.([\w]+)\s*\}\}$/)?.[1];
  const resolved = key ? env[key] : value;
  return typeof resolved === "string" && !resolved.includes("${{") ? resolved : undefined;
}

function hasFrontendSetting(text: string): boolean {
  return /(?:-Z\s*["']?\s*,?\s*["']?\s*threads\b|--jobs(?:-frontend)?\b)/.test(
    text.replaceAll("\u001f", " "),
  );
}

async function configHasFrontendSetting(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
  context: RuleContext,
): Promise<boolean> {
  const scan = context.scanContext;
  if (!scan) {
    return false;
  }
  const directory = workflowWorkingDirectory(workflow, job, step);
  if (directory.includes("$") || path.isAbsolute(directory)) {
    return true;
  }
  let relative = path.normalize(directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return true;
  }
  for (;;) {
    for (const name of ["config", "config.toml"]) {
      const configPath = scan.resolve(relative, ".cargo", name);
      if (await scan.pathExists(configPath)) {
        const text = await scan.readTextFileOrWarn(configPath);
        if (text === undefined || hasFrontendSetting(text.replace(/^\s*#.*$/gm, ""))) {
          return true;
        }
      }
    }
    if (relative === ".") {
      return false;
    }
    relative = path.dirname(relative);
  }
}

export const considerRustNightlyParallelFrontendRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];
    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || job.raw.if === false) {
        continue;
      }
      let defaultToolchain: string | undefined;
      let shellConfigurationUnknown = false;
      const affected: WorkflowStep[] = [];
      for (const step of job.steps) {
        if (step.node.get("if") === false) {
          continue;
        }
        const env = workflowStepEnv(workflow, job, step);
        const action = step.uses?.match(/^dtolnay\/rust-toolchain@(.+)$/i);
        if (action) {
          defaultToolchain = step.if
            ? undefined
            : resolveToolchain(step.with?.toolchain ?? action[1], env);
        }
        const run = step.run ?? "";
        // Shell-written state and config overrides require execution to resolve safely.
        if (
          /\b(?:RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|RUSTUP_TOOLCHAIN|CARGO_HOME)\s*=|\brustup\s+(?:default|override)\b|\$GITHUB_ENV/.test(
            run,
          )
        ) {
          shellConfigurationUnknown = true;
        }
        if (shellConfigurationUnknown) {
          continue;
        }
        const flags = env.CARGO_ENCODED_RUSTFLAGS ?? env.RUSTFLAGS ?? env.CARGO_BUILD_RUSTFLAGS;
        if (
          env.CARGO_HOME !== undefined ||
          (env.RUSTUP_TOOLCHAIN !== undefined &&
            resolveToolchain(env.RUSTUP_TOOLCHAIN, env) === undefined) ||
          (flags !== undefined &&
            (typeof flags !== "string" || flags.includes("$") || hasFrontendSetting(flags)))
        ) {
          continue;
        }
        const segments = shellCommandSegments(run);
        if (segments.some((segment) => /^cd\s/.test(segment))) {
          continue;
        }
        const nightlyCommands = segments.some((segment) => {
          const words = staticShellWords(segment);
          if (
            words?.[0] !== "cargo" ||
            words.includes("--config") ||
            words.some((word) => word.startsWith("--config="))
          ) {
            return false;
          }
          let index = 1;
          const explicitToolchain = words[index]?.startsWith("+")
            ? words[index++]!.slice(1)
            : undefined;
          const toolchain =
            explicitToolchain ?? resolveToolchain(env.RUSTUP_TOOLCHAIN, env) ?? defaultToolchain;
          if (!isNightly(toolchain)) {
            return false;
          }
          const verb = words[index];
          return (
            verb === "build" ||
            verb === "test" ||
            verb === "check" ||
            (verb === "nextest" && words[index + 1] === "run")
          );
        });
        if (nightlyCommands && !(await configHasFrontendSetting(workflow, job, step, context))) {
          affected.push(step);
        }
      }
      const first = affected[0];
      if (!first) {
        continue;
      }
      findings.push(
        buildDiagnostic(workflow, meta, first.runNode ?? first.node, {
          message: `Job "${job.id}" compiles Rust with nightly in ${affected.length} step(s) without a visible frontend parallelism setting.`,
          why: "Cargo already compiles crates in parallel, but a large remaining crate can leave cores idle. Nightly frontend parallelism may reduce that tail; gains depend on the workload and memory use can increase.",
          suggestion:
            "Benchmark RUSTFLAGS with -Zthreads=0 on the existing nightly toolchain, preserving other flags. Use --jobs-frontend=0 instead where supported; retain deliberate thread limits.",
          measurementHint:
            "Compare compilation and total job wall-clock time plus peak memory on the same runner, toolchain, features, and cache state. Keep the setting only if measurements improve.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}"; verify the pinned nightly supports -Zthreads=0 (or --jobs-frontend=0), preserve existing flags and toolchains, and benchmark runtime and peak memory before enabling frontend parallelism.`,
          score: 25,
        }),
      );
    }
    return findings;
  },
};
