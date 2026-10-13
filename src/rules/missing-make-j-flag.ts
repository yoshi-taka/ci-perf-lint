import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectMakeBuildCommands, type MakeBuildCommand } from "./shared/make-build-commands.ts";
import { workflowStepEnv, workflowWorkingDirectory } from "./shared/workflow-command-context.ts";
import {
  parseMakefile,
  extractMakeTarget,
  collectRecipeChain,
  detectInternalParallelTool,
} from "./shared/makefile-parser.ts";

const meta = {
  id: "missing-make-j-flag",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/missing-make-j-flag.md",
} satisfies RuleMeta;

function getRepoRoot(workflow: WorkflowDocument): string {
  const relDir = path.dirname(workflow.relativePath);
  const upCount = relDir === "." ? 0 : relDir.split("/").length;
  const parts = Array.from({ length: upCount }, () => "..");
  return path.resolve(path.dirname(workflow.path), ...parts);
}

async function stepTargetIsInternalParallel(
  workflow: WorkflowDocument,
  command: MakeBuildCommand,
  scanContext?: RepositoryScanContext,
): Promise<boolean> {
  if (
    !scanContext ||
    command.customMakefile ||
    command.targets.length !== 1 ||
    command.directory === undefined ||
    path.posix.isAbsolute(command.directory) ||
    command.directory === ".." ||
    command.directory.startsWith("../")
  ) {
    return false;
  }

  const target = extractMakeTarget(command.text);
  if (!target) {
    return false;
  }

  const repoRoot = getRepoRoot(workflow);
  const dir = path.resolve(repoRoot, command.directory);

  const parsed = await scanContext.parseMakefileAtDir(dir);
  if (!parsed) {
    return false;
  }

  for (const inc of parsed.includes) {
    const incPath = path.resolve(dir, inc.trim());
    const incContent = await scanContext.readTextFileOrWarn(incPath);
    if (incContent === undefined) {
      continue;
    }

    const incParsed = parseMakefile(incContent);
    for (const [k, v] of incParsed.targets) {
      if (!parsed.targets.has(k)) {
        parsed.targets.set(k, v);
      }
    }
    for (const [k, v] of incParsed.variables) {
      if (!parsed.variables.has(k)) {
        parsed.variables.set(k, v);
      }
    }
  }

  const recipes = collectRecipeChain(target, parsed.targets, parsed.variables);
  return detectInternalParallelTool(recipes, parsed.variables) !== null;
}

interface DelinquentStep {
  step: WorkflowStep;
  kind: "make" | "cmake";
}

async function collectDelinquentSteps(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  scanContext?: RepositoryScanContext,
): Promise<DelinquentStep[]> {
  const result: DelinquentStep[] = [];
  const generators = new Map<string, string | undefined>();
  for (const step of job.steps) {
    for (const command of collectMakeBuildCommands(
      step.run ?? "",
      workflowStepEnv(workflow, job, step),
      workflowWorkingDirectory(workflow, job, step),
    )) {
      if (command.kind === "cmake-configure") {
        if (command.directory !== undefined) {
          generators.set(command.directory, command.generator);
        }
        continue;
      }
      if (!command.needsParallel) {
        continue;
      }
      if (
        command.kind === "make" &&
        (await stepTargetIsInternalParallel(workflow, command, scanContext))
      ) {
        continue;
      }
      const generator =
        command.directory === undefined ? undefined : generators.get(command.directory);
      if (
        command.kind === "cmake" &&
        (generator === "Ninja" || generator === "Ninja Multi-Config")
      ) {
        continue;
      }
      if (!result.some((item) => item.step === step && item.kind === command.kind)) {
        result.push({ step, kind: command.kind });
      }
    }
  }
  return result;
}

function formatSuggestion(delinquent: DelinquentStep[]): string {
  const hasMake = delinquent.some((d) => d.kind === "make");
  const hasCmake = delinquent.some((d) => d.kind === "cmake");

  const parts: string[] = [];
  if (hasMake) {
    parts.push(
      "Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in workflow/job/step env.",
    );
  }
  if (hasCmake) {
    parts.push(
      "Add -j$(nproc) or --parallel to cmake --build, or set CMAKE_BUILD_PARALLEL_LEVEL in workflow/job/step env.",
    );
  }
  return parts.join(" ");
}

export const missingMakeJFlagRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext) {
    const findings: Diagnostic[] = [];
    const { scanContext } = context;

    for (const job of workflow.jobs) {
      const delinquent = await collectDelinquentSteps(workflow, job, scanContext);
      if (delinquent.length === 0) {
        continue;
      }

      const firstStep = delinquent[0]!.step;
      const stepNumbers = [...new Set(delinquent.map((d) => job.steps.indexOf(d.step) + 1))];
      const stepList =
        stepNumbers.length === 1 ? `step #${stepNumbers[0]}` : `steps #${stepNumbers.join(", #")}`;

      const kinds = [...new Set(delinquent.map((d) => d.kind))];
      const toolLabel =
        kinds.length > 1
          ? "make/gmake and cmake --build"
          : kinds[0] === "cmake"
            ? "cmake --build"
            : "make/gmake";

      findings.push(
        buildDiagnostic(workflow, meta, firstStep.runNode ?? firstStep.node, {
          message: `Job "${job.id}" runs ${toolLabel} without visible parallel controls in ${stepList}.`,
          why: "No applicable command or environment parallel settings are visible for this build path. Make normally runs serially unless its build configuration supplies parallelism; CMake defaults depend on the native generator. Matching available CPUs can reduce wall time for independent build work.",
          suggestion: formatSuggestion(delinquent),
          measurementHint: "Compare build step duration before and after adding parallel flags.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add parallelization flags to ${toolLabel} commands.`,
          score: 55,
        }),
      );
    }

    return findings;
  },
};
