import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import { isScalar } from "yaml";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import { effectiveStepEnvironment } from "../rules/shared/workflow-env.ts";
import { shellCommandSegments, staticShellWords } from "../rules/shared/command-patterns.ts";

const meta = {
  id: "pytest-xdist-installed-but-not-used",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/pytest-xdist-installed-but-not-used.md",
} satisfies RuleMeta;

const XDIST_FLAG = /(?:^|\s)(?:-n(?:\s|\d|auto|logical|$)|--numprocesses(?:\s|=|$))/;

async function optionalText(context: RepositoryScanContext, file: string) {
  const filePath = context.resolve(file);
  return (await context.pathExists(filePath)) ? context.readTextFileOrWarn(filePath) : undefined;
}

async function hasPytestXdistInDeps(context: RepositoryScanContext): Promise<boolean> {
  const pyprojectText = await optionalText(context, "pyproject.toml");
  if (pyprojectText && /\bpytest-xdist\b/.test(pyprojectText)) {
    return true;
  }

  for (const file of ["requirements.txt", "requirements-dev.txt", "requirements-test.txt"]) {
    const text = await optionalText(context, file);
    if (text && /^pytest-xdist\b/m.test(text)) {
      return true;
    }
  }

  for (const file of ["Pipfile.lock", "poetry.lock", "uv.lock"]) {
    const text = await optionalText(context, file);
    if (text && /\bpytest-xdist\b/.test(text)) {
      return true;
    }
  }

  return false;
}

async function configEnablesXdist(context: RepositoryScanContext): Promise<boolean> {
  for (const file of ["pytest.ini", "setup.cfg", "tox.ini"]) {
    const text = await optionalText(context, file);
    if (!text) {
      continue;
    }
    const m = text.match(/^addopts\s*=\s*(.+)$/m);
    if (m?.[1] && XDIST_FLAG.test(m[1])) {
      return true;
    }
  }

  const pyprojectText = await optionalText(context, "pyproject.toml");
  if (pyprojectText) {
    const m = pyprojectText.match(/addopts\s*=\s*["']([^"']*)["']/);
    if (m?.[1] && XDIST_FLAG.test(m[1])) {
      return true;
    }
  }

  return false;
}

async function suiteLooksLarge(context: RepositoryScanContext): Promise<boolean> {
  for (const dir of ["tests", "test", "specs"]) {
    const entries = await context.readDirectoryEntries(context.resolve(dir)).catch(() => undefined);
    if (!entries) {
      continue;
    }
    let count = 0;
    for (const e of entries) {
      if (e.isFile() && /^test_.*\.py$/.test(e.name) && ++count >= 30) {
        return true;
      }
    }
  }

  return false;
}

function findPytestCommands(
  workflows: WorkflowDocument[],
): { workflow: WorkflowDocument; step: WorkflowStep; command: string; lineOffset: number }[] {
  const results: {
    workflow: WorkflowDocument;
    step: WorkflowStep;
    command: string;
    lineOffset: number;
  }[] = [];

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const env = effectiveStepEnvironment(workflow, job, step);
        const run = step.run ?? "";
        let searchStart = 0;
        for (const segment of shellCommandSegments(run)) {
          const index = run.indexOf(segment, searchStart);
          if (index >= 0) {
            searchStart = index + segment.length;
          }
          // Unknown expansions cannot prove that xdist is disabled. Preserve single quotes.
          const expanded = segment.replace(
            /'[^']*'|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
            (token, braced: string | undefined, plain: string | undefined) => {
              if (token.startsWith("'")) {
                return token;
              }
              const value = env[braced ?? plain ?? ""];
              if (typeof value !== "string" || /[$`\n]/.test(value)) {
                return token;
              }
              return value;
            },
          );
          const words = staticShellWords(expanded);
          if (!words) {
            continue;
          }
          const executable = words.findIndex((word) => !/^[A-Za-z_]\w*=/.test(word));
          const pytestIndex = words.indexOf("pytest");
          if (pytestIndex < 0 || executable < 0) {
            continue;
          }
          const first = words[executable]!;
          if (
            pytestIndex !== executable &&
            !(
              /^(?:python\d*(?:\.\d+)?|uv|poetry|pdm)$/.test(first) &&
              words
                .slice(executable, pytestIndex)
                .includes(first.startsWith("python") ? "-m" : "run")
            )
          ) {
            continue;
          }
          const args = words.slice(pytestIndex + 1);
          if (XDIST_FLAG.test(args.join(" "))) {
            continue;
          }
          if (args.some((arg) => /^(?:--pdb|--trace|--forked|-s|--capture=no)$/.test(arg))) {
            continue;
          }
          if (
            args.some(
              (arg, i) =>
                args[i - 1] === "-m" &&
                /\b(?:integration|e2e|smoke|db|database|migration|alembic|django)\b/.test(arg),
            )
          ) {
            continue;
          }
          if (args.filter((arg) => /\.py(?:::|$)/.test(arg)).length === 1) {
            continue;
          }
          results.push({
            workflow,
            step,
            command: segment,
            lineOffset: run.slice(0, Math.max(0, index)).split("\n").length - 1,
          });
        }
      }
    }
  }

  return results;
}

export async function collectPytestXdistInstalledButNotUsedDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (!(await hasPytestXdistInDeps(context))) {
    return [];
  }

  if (await configEnablesXdist(context)) {
    return [];
  }

  const large = await suiteLooksLarge(context);

  const diagnostics: Diagnostic[] = [];

  for (const { workflow, step, command, lineOffset } of findPytestCommands(workflows)) {
    if (!large) {
      continue;
    }
    const blockOffset =
      isScalar(step.runNode) &&
      (step.runNode.type === "BLOCK_LITERAL" || step.runNode.type === "BLOCK_FOLDED")
        ? 1
        : 0;

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: workflow.relativePath,
          line:
            (step.runNode?.range
              ? (workflow.lineCounter?.linePos(step.runNode.range[0]).line ?? 1)
              : 1) +
            lineOffset +
            blockOffset,
          column: 1,
        },
        message: `pytest-xdist is installed, but this CI command runs pytest without parallel workers: ${command}`,
        why: "For a large test suite, pytest-xdist can reduce wall-clock time by distributing tests across CPU cores. Since the project already includes pytest-xdist as a dependency, parallel execution was likely intended but not enabled in CI.",
        suggestion:
          "Add -n auto to the pytest command, or configure addopts = -n auto in pytest.ini, setup.cfg, tox.ini, or pyproject.toml.",
        measurementHint:
          "Compare test job duration with and without -n auto. The speedup depends on CPU count and test isolation compatibility.",
        aiHandoff: `Review ${workflow.relativePath} and add -n auto to the pytest command. If the test suite has interdependency issues, consider the --dist worksteal scheduler instead of the default load scope.`,
        score: 60,
      }),
    );
  }

  return diagnostics;
}
