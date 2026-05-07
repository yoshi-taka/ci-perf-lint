import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "pytest-xdist-installed-but-not-used",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/pytest-xdist-installed-but-not-used.md",
} satisfies RuleMeta;

const DIRECT_PYTEST = /\b(?:python\d?\s+-m\s+)?pytest\b/;

const INSTALL_COMMAND = /\b(?:pip|pip3|pipx)\s+install\b/;

const XDIST_FLAG = /(?:\s|^)(?:-n|--numprocesses)(?:\s|$)/;

const SERIAL_MARKER = /\s+-m\s+(integration|e2e|smoke|db|database|migration|alembic|django)\b/;

const DEBUG_FLAG = /(?:\s|^)(?:--pdb|--trace|--forked|-s\b|--capture=no)(?:\s|$)/;

const SINGLE_FILE = /\bpytest\s+\S*test_\S*\.py\b/;

const WRAPPER = /\b(?:tox|nox|make\s+test|npm\s+test|just\s+test)\b/;

async function hasPytestXdistInDeps(context: RepositoryScanContext): Promise<boolean> {
  const pyprojectPath = context.resolve("pyproject.toml");
  const pyprojectText = await context.readTextFileOrWarn(pyprojectPath);
  if (pyprojectText && /\bpytest-xdist\b/.test(pyprojectText)) {
    return true;
  }

  for (const file of ["requirements.txt", "requirements-dev.txt", "requirements-test.txt"]) {
    const text = await context.readTextFileOrWarn(context.resolve(file));
    if (text && /^pytest-xdist\b/m.test(text)) {
      return true;
    }
  }

  for (const file of ["Pipfile.lock", "poetry.lock", "uv.lock"]) {
    const text = await context.readTextFileOrWarn(context.resolve(file));
    if (text && /\bpytest-xdist\b/.test(text)) {
      return true;
    }
  }

  return false;
}

async function configEnablesXdist(context: RepositoryScanContext): Promise<boolean> {
  for (const file of ["pytest.ini", "setup.cfg", "tox.ini"]) {
    const text = await context.readTextFileOrWarn(context.resolve(file));
    if (!text) {
      continue;
    }
    const m = text.match(/^addopts\s*=\s*(.+)$/m);
    if (m?.[1] && (/\b-n\b/.test(m[1]) || /\b--numprocesses\b/.test(m[1]))) {
      return true;
    }
  }

  const pyprojectText = await context.readTextFileOrWarn(context.resolve("pyproject.toml"));
  if (pyprojectText) {
    const m = pyprojectText.match(/addopts\s*=\s*["']([^"']*)["']/);
    if (m?.[1] && (/\b-n\b/.test(m[1]) || /\b--numprocesses\b/.test(m[1]))) {
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
): { workflow: WorkflowDocument; command: string }[] {
  const results: { workflow: WorkflowDocument; command: string }[] = [];

  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (!DIRECT_PYTEST.test(run) || WRAPPER.test(run) || INSTALL_COMMAND.test(run)) {
          continue;
        }
        results.push({ workflow, command: run });
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

  for (const { workflow, command } of findPytestCommands(workflows)) {
    if (XDIST_FLAG.test(command)) {
      continue;
    }
    if (DEBUG_FLAG.test(command)) {
      continue;
    }
    if (SERIAL_MARKER.test(command)) {
      continue;
    }
    if (SINGLE_FILE.test(command)) {
      continue;
    }
    if (!large) {
      continue;
    }

    diagnostics.push(
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: workflow.relativePath,
          line: 1,
          column: 1,
        },
        message:
          "pytest-xdist is installed, but this CI command runs pytest without parallel workers.",
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
