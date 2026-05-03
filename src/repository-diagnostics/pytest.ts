import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { workflowStepTextMatches } from "../rules/shared/workflow-analysis.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const testpathsMeta = {
  id: "pytest-testpaths-unconfigured",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/pytest-testpaths-unconfigured.md",
} satisfies RuleMeta;

const norecursedirsMeta = {
  id: "pytest-norecursedirs-override",
  severity: "suggestion",
  confidence: "high",
  docsPath: "docs/rules/pytest-norecursedirs-override.md",
} satisfies RuleMeta;

interface PytestConfig {
  filePath: string;
  testpathsConfigured: boolean;
  norecursedirsConfigured: boolean;
  norecursedirsRaw?: string;
  norecursedirsLine: number;
}

const pytestDefaultNorecursedirs = [
  ".git",
  ".hg",
  ".svn",
  "CVS",
  "_darcs",
  "{arch}",
  "*.egg",
  "node_modules",
] as const;

function parseNorecursedirsValues(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return trimmed
      .slice(1, trimmed.endsWith("]") ? -1 : trimmed.length)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
  }
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function entryMatchesDirname(entry: string, dirname: string): boolean {
  if (entry === ".*" && dirname.startsWith(".")) {
    return true;
  }
  if (entry === dirname) {
    return true;
  }
  const pattern = entry.replace(/\*/g, ".*").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`^${pattern}$`).test(dirname);
  } catch {
    return entry === dirname;
  }
}

function defaultIsCoveredByUser(defaultEntry: string, userEntries: string[]): boolean {
  for (const userEntry of userEntries) {
    if (entryMatchesDirname(userEntry, defaultEntry)) {
      return true;
    }
  }
  return false;
}

function parseIniLikeSection(text: string, sectionHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split("\n");
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed.toLowerCase() === `[${sectionHeader.toLowerCase()}]`;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function parseTomlLikePytestSection(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split("\n");
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed.toLowerCase() === "[tool.pytest.ini_options]";
      continue;
    }
    if (!inSection) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    if (key) {
      result[key] = rawValue;
    }
  }
  return result;
}

function findKeyLine(text: string, key: string): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} =`)) {
      return i + 1;
    }
  }
  return 1;
}

async function readPytestConfig(context: RepositoryScanContext): Promise<PytestConfig | undefined> {
  const pytestIniPath = context.resolve("pytest.ini");
  if (await context.pathExists(pytestIniPath)) {
    const text = await context.readTextFileOrWarn(pytestIniPath);
    if (text) {
      const config = parseIniLikeSection(text, "pytest");
      return {
        filePath: "pytest.ini",
        testpathsConfigured: "testpaths" in config,
        norecursedirsConfigured: "norecursedirs" in config,
        norecursedirsRaw: config.norecursedirs,
        norecursedirsLine:
          config.norecursedirs !== undefined ? findKeyLine(text, "norecursedirs") : 1,
      };
    }
  }

  const iniSections = [
    { file: "setup.cfg", section: "tool:pytest" },
    { file: "tox.ini", section: "pytest" },
  ] as const;

  for (const { file, section } of iniSections) {
    const filePath = context.resolve(file);
    if (!(await context.pathExists(filePath))) {
      continue;
    }
    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }
    const config = parseIniLikeSection(text, section);
    if (Object.keys(config).length === 0) {
      continue;
    }
    return {
      filePath: file,
      testpathsConfigured: "testpaths" in config,
      norecursedirsConfigured: "norecursedirs" in config,
      norecursedirsRaw: config.norecursedirs,
      norecursedirsLine:
        config.norecursedirs !== undefined ? findKeyLine(text, "norecursedirs") : 1,
    };
  }

  const pyprojectPath = context.resolve("pyproject.toml");
  if (await context.pathExists(pyprojectPath)) {
    const text = await context.readTextFileOrWarn(pyprojectPath);
    if (text) {
      const config = parseTomlLikePytestSection(text);
      if (Object.keys(config).length > 0) {
        return {
          filePath: "pyproject.toml",
          testpathsConfigured: "testpaths" in config,
          norecursedirsConfigured: "norecursedirs" in config,
          norecursedirsRaw: config.norecursedirs,
          norecursedirsLine:
            config.norecursedirs !== undefined ? findKeyLine(text, "norecursedirs") : 1,
        };
      }
    }
  }

  return undefined;
}

function ciWorkflowHasPytestPaths(workflows: WorkflowDocument[]): boolean {
  for (const workflow of workflows) {
    if (workflowStepTextMatches(workflow, /\bpytest[ \t]+(?:-\S*[ \t]+)*[^-]\S/)) {
      return true;
    }
    if (
      workflowStepTextMatches(workflow, /python[ \t]+-m[ \t]+pytest[ \t]+(?:-\S*[ \t]+)*[^-]\S/)
    ) {
      return true;
    }
  }
  return false;
}

async function findMissingDefaultDirs(
  context: RepositoryScanContext,
  userEntries: string[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const defaultEntry of pytestDefaultNorecursedirs) {
    if (defaultIsCoveredByUser(defaultEntry, userEntries)) {
      continue;
    }
    if (defaultEntry === "*.egg") {
      const rootEntries = await context.readDirectoryEntries(context.repoRoot);
      const hasEggDir = [...rootEntries].some((e) => e.name.endsWith(".egg") && e.isDirectory());
      if (hasEggDir) {
        missing.push(defaultEntry);
      }
      continue;
    }
    const dirPath = context.resolve(defaultEntry);
    if (await context.pathExists(dirPath)) {
      missing.push(defaultEntry);
    }
  }
  return missing;
}

export async function collectPytestDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  const config = await readPytestConfig(context);

  const hasCiPathArgs = ciWorkflowHasPytestPaths(workflows);
  const configOrFallbackPath = config?.filePath ?? ".github/workflows/ci.yml";

  if (!config || !config.testpathsConfigured) {
    if (!hasCiPathArgs) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, testpathsMeta, {
          location: {
            path: configOrFallbackPath,
            line: 1,
            column: 1,
          },
          message: "pytest testpaths is not configured.",
          why: "Without testpaths, pytest scans the entire repository tree for test files, which is slow in large projects.",
          suggestion:
            "Set testpaths in pytest.ini, pyproject.toml ([tool.pytest.ini_options]), setup.cfg, or tox.ini to limit the search scope.",
          measurementHint: "Run pytest --collect-only before and after to compare collection time.",
          aiHandoff:
            "Add testpaths to the existing pytest config file. Use the most specific path, e.g. tests/.",
          score: 45,
        }),
      );
    }

    if (config?.norecursedirsConfigured && config.norecursedirsRaw) {
      const userEntries = parseNorecursedirsValues(config.norecursedirsRaw);
      const missing = await findMissingDefaultDirs(context, userEntries);
      if (missing.length > 0) {
        diagnostics.push(
          buildRepositoryDiagnostic(repository, norecursedirsMeta, {
            location: {
              path: config.filePath,
              line: config.norecursedirsLine,
              column: 1,
            },
            message: `pytest norecursedirs overrides defaults but is missing directories that exist in the repo: ${missing.join(", ")}.`,
            why: "Setting norecursedirs replaces pytest's built-in default list instead of extending it. Missing entries like node_modules, .git, etc. will now be scanned, slowing test collection.",
            suggestion: `Add the missing entries to norecursedirs: ${missing.join(", ")}.`,
            measurementHint: "Run pytest --collect-only and check which directories are scanned.",
            aiHandoff:
              "Add the missing default directories to the norecursedirs list in the pytest config file.",
            score: 35,
          }),
        );
      }
    }
  }

  return diagnostics;
}
