import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "cargo-build-before-test",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/cargo-build-before-test.md",
} satisfies RuleMeta;

interface CargoConfig {
  profile: "debug" | "release";
  allFeatures: boolean;
  noDefaultFeatures: boolean;
  features: string[];
  target: string | undefined;
  packageScope: { type: "workspace" } | { type: "package"; name: string } | { type: "default" };
  targetSelection: string[];
}

function tokenizeRun(run: string): string[] {
  return run
    .replace(/\\\n/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function parseCargoConfig(tokens: string[], startIndex: number): CargoConfig | undefined {
  const config: CargoConfig = {
    profile: "debug",
    allFeatures: false,
    noDefaultFeatures: false,
    features: [],
    target: undefined,
    packageScope: { type: "default" },
    targetSelection: [],
  };

  for (let i = startIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) {
      break;
    }
    if (token.startsWith("#")) {
      break;
    }
    if (
      token === ";" ||
      token === "&&" ||
      token === "||" ||
      token === "|" ||
      token === "`" ||
      token.startsWith("$") ||
      token.startsWith("(")
    ) {
      break;
    }

    if (token === "--release" || token === "-r") {
      config.profile = "release";
      continue;
    }
    if (token === "--all-features") {
      config.allFeatures = true;
      continue;
    }
    if (token === "--no-default-features") {
      config.noDefaultFeatures = true;
      continue;
    }
    if (token === "--features" || token === "-F") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        config.features.push(...next.split(",").map((f) => f.trim()));
        i++;
      }
      continue;
    }
    if (token === "--target") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        config.target = next;
        i++;
      }
      continue;
    }
    if (token === "--workspace" || token === "-w") {
      config.packageScope = { type: "workspace" };
      continue;
    }
    if (token === "--package" || token === "-p") {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        config.packageScope = { type: "package", name: next };
        i++;
      }
      continue;
    }
    const targetFlags = ["--bins", "--lib", "--tests", "--examples", "--benches", "--all-targets"];
    if (targetFlags.includes(token)) {
      config.targetSelection.push(token);
      continue;
    }
  }

  config.features.sort();
  config.targetSelection.sort();
  return config;
}

function stepRunsCargoBuild(
  step: WorkflowStep,
): { config: CargoConfig; tokens: string[]; index: number } | undefined {
  const run = step.run ?? "";
  if (!/\bcargo\s+build\b/i.test(run)) {
    return undefined;
  }
  const tokens = tokenizeRun(run);
  const idx = tokens.findIndex((t) => t.toLowerCase() === "cargo");
  if (idx === -1 || tokens[idx + 1]?.toLowerCase() !== "build") {
    return undefined;
  }
  const config = parseCargoConfig(tokens, idx + 2);
  if (!config) {
    return undefined;
  }
  return { config, tokens, index: idx };
}

function stepRunsCargoTest(
  step: WorkflowStep,
): { config: CargoConfig; hasNoRun: boolean } | undefined {
  const run = step.run ?? "";
  if (!/\bcargo\s+test\b/i.test(run)) {
    return undefined;
  }
  const tokens = tokenizeRun(run);
  const idx = tokens.findIndex((t) => t.toLowerCase() === "cargo");
  if (idx === -1 || tokens[idx + 1]?.toLowerCase() !== "test") {
    return undefined;
  }
  const config = parseCargoConfig(tokens, idx + 2);
  if (!config) {
    return undefined;
  }
  const hasNoRun = tokens.slice(idx + 2).some((t) => t === "--no-run");
  return { config, hasNoRun };
}

function configsMatch(a: CargoConfig, b: CargoConfig): boolean {
  if (a.profile !== b.profile) {
    return false;
  }
  if (a.allFeatures !== b.allFeatures) {
    return false;
  }
  if (a.noDefaultFeatures !== b.noDefaultFeatures) {
    return false;
  }
  if (a.target !== b.target) {
    return false;
  }
  if (a.packageScope.type !== b.packageScope.type) {
    return false;
  }
  if (a.packageScope.type === "package" && b.packageScope.type === "package") {
    if (a.packageScope.name !== b.packageScope.name) {
      return false;
    }
  }
  if (a.targetSelection.length !== b.targetSelection.length) {
    return false;
  }
  for (let i = 0; i < a.targetSelection.length; i++) {
    if (a.targetSelection[i] !== b.targetSelection[i]) {
      return false;
    }
  }
  if (a.features.length !== b.features.length) {
    return false;
  }
  for (let i = 0; i < a.features.length; i++) {
    if (a.features[i] !== b.features[i]) {
      return false;
    }
  }
  return true;
}

function findRedundantBuildBeforeTest(
  job: WorkflowJob,
): { buildStep: WorkflowStep; testStep: WorkflowStep } | undefined {
  for (let i = 0; i < job.steps.length; i++) {
    const buildStep = job.steps[i];
    if (!buildStep) {
      continue;
    }
    const buildResult = stepRunsCargoBuild(buildStep);
    if (!buildResult) {
      continue;
    }

    for (let j = i + 1; j <= i + 3 && j < job.steps.length; j++) {
      const testStep = job.steps[j];
      if (!testStep) {
        continue;
      }
      const testResult = stepRunsCargoTest(testStep);
      if (!testResult) {
        continue;
      }
      if (testResult.hasNoRun) {
        continue;
      }
      if (configsMatch(buildResult.config, testResult.config)) {
        return { buildStep, testStep };
      }
    }
  }
  return undefined;
}

export const cargoBuildBeforeTestRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    return workflow.jobs.flatMap((job) => {
      if (job.usesReusableWorkflow) {
        return [];
      }

      const redundant = findRedundantBuildBeforeTest(job);
      if (!redundant) {
        return [];
      }

      return [
        buildDiagnostic(workflow, meta, redundant.buildStep.runNode ?? redundant.buildStep.node, {
          message: `Job "${job.id}" runs \`cargo build\` shortly before \`cargo test\` with identical build conditions.`,
          why: "`cargo test` compiles the required targets automatically. A preceding `cargo build` with the same profile, target, features, and package scope is usually redundant.",
          suggestion:
            "Remove the `cargo build` step, or use `cargo test --no-run` if you need an explicit compile phase.",
          measurementHint:
            "Compare job runtime with and without the `cargo build` step while keeping the `cargo test` step.",
          aiHandoff: `Review job "${job.id}" in ${workflow.relativePath}; remove the redundant \`cargo build\` step before \`cargo test\` if it has no separate required output.`,
          score: 62,
        }),
      ];
    });
  },
};
