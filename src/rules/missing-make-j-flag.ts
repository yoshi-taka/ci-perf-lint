import { isMap, type Node } from "yaml";
import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../workflow.ts";
import { getNode, getScalarString } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import type { ParsedMakefile } from "./shared/makefile-parser.ts";
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

const MAKE_LIKE = /^\s*(?:make|gmake)\b/;
const CMAKE_BUILD = /^\s*cmake\s+--build\b/;
const HAS_PARALLEL_FLAG = /(?:^|\s)(?:-j\s*\d*|--jobs(?:\s*=\s*\d+)?|--parallel)\b/;
const HAS_NINJA = /\b[Nn]inja\b/;

function getRepoRoot(workflow: WorkflowDocument): string {
  const relDir = path.dirname(workflow.relativePath);
  const upCount = relDir === "." ? 0 : relDir.split("/").length;
  const parts = Array.from({ length: upCount }, () => "..");
  return path.resolve(path.dirname(workflow.path), ...parts);
}

async function stepTargetIsInternalParallel(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
  scanContext?: RepositoryScanContext,
): Promise<boolean> {
  if (!scanContext) {
    return false;
  }

  const run = step.run?.trim();
  if (!run) {
    return false;
  }

  const target = extractMakeTarget(run);
  if (!target) {
    return false;
  }

  const repoRoot = getRepoRoot(workflow);
  const jobWd = getScalarString(getNode(job.node, "working-directory"));
  const workingDir = step.workingDirectory ?? jobWd ?? undefined;
  const dir = workingDir ? path.resolve(repoRoot, workingDir) : repoRoot;

  let parsed: ParsedMakefile | null = null;
  for (const name of ["GNUmakefile", "makefile", "Makefile"]) {
    const fp = path.resolve(dir, name);
    const source = await scanContext.readTextFileOrWarn(fp);
    if (source !== undefined) {
      parsed = parseMakefile(source);
      break;
    }
  }
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

function hasParallelFlagInCommand(run: string): boolean {
  return HAS_PARALLEL_FLAG.test(run);
}

function* collectEnvMaps(
  workflow: WorkflowDocument,
  job: WorkflowJob,
  step: WorkflowStep,
): Generator<Node> {
  const workflowEnvNode = workflow.root ? getNode(workflow.root, "env") : undefined;
  if (workflowEnvNode) {
    yield workflowEnvNode;
  }

  const jobEnvNode = getNode(job.node, "env");
  if (jobEnvNode) {
    yield jobEnvNode;
  }

  const stepEnvNode = getNode(step.node, "env");
  if (stepEnvNode) {
    yield stepEnvNode;
  }
}

function envContains(envMap: Node, key: string, valuePattern?: RegExp): boolean {
  if (!isMap(envMap)) {
    return false;
  }
  for (const item of envMap.items) {
    const k = getScalarString(item.key);
    if (k !== key) {
      continue;
    }
    if (!valuePattern) {
      return true;
    }
    const v = getScalarString(item.value);
    if (v && valuePattern.test(v)) {
      return true;
    }
  }
  return false;
}

function jobUsesNinja(job: WorkflowJob): boolean {
  for (const step of job.steps) {
    if (step.run && HAS_NINJA.test(step.run)) {
      return true;
    }
  }
  return false;
}

function hasParallelEnv(workflow: WorkflowDocument, job: WorkflowJob, step: WorkflowStep): boolean {
  for (const envMap of collectEnvMaps(workflow, job, step)) {
    if (envContains(envMap, "MAKEFLAGS", /(?:^|\s)-j/)) {
      return true;
    }
    if (envContains(envMap, "CMAKE_BUILD_PARALLEL_LEVEL", /\d+/)) {
      return true;
    }
  }
  return false;
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
  for (const step of job.steps) {
    const run = step.run?.trim();
    if (!run || run.includes("\n")) {
      continue;
    }

    let kind: "make" | "cmake" | undefined;
    if (MAKE_LIKE.test(run)) {
      kind = "make";
    } else if (CMAKE_BUILD.test(run)) {
      kind = "cmake";
    }

    if (!kind) {
      continue;
    }
    if (hasParallelFlagInCommand(run)) {
      continue;
    }
    if (hasParallelEnv(workflow, job, step)) {
      continue;
    }
    if (kind === "make" && (await stepTargetIsInternalParallel(workflow, job, step, scanContext))) {
      continue;
    }
    if (kind === "cmake" && jobUsesNinja(job)) {
      continue;
    }

    result.push({ step, kind });
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
      const stepNumbers = delinquent.map((d) => job.steps.indexOf(d.step) + 1);
      const stepList =
        stepNumbers.length === 1 ? `step #${stepNumbers[0]}` : `steps #${stepNumbers.join(", #")}`;

      const kinds = [...new Set(delinquent.map((d) => d.kind))];
      const toolLabel = kinds.length === 1 && kinds[0] === "cmake" ? "cmake --build" : "make/gmake";

      findings.push(
        buildDiagnostic(workflow, meta, firstStep.runNode ?? firstStep.node, {
          message: `Job "${job.id}" runs ${toolLabel} without parallelization in ${stepList}.`,
          why:
            delinquent.length === 1
              ? "Make defaults to serial execution. Explicit parallelization matches runner CPU count and cuts build wall time significantly."
              : `Make defaults to serial execution. ${delinquent.length} commands in the same job each run serially, multiplying the wasted wall time.`,
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
