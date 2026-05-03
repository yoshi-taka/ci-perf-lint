import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { parseSemverLikeVersionSpec } from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-mypy-performance-milestone",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-mypy-performance-milestone.md",
} satisfies RuleMeta;

const dependencyFileNames = [
  "pyproject.toml",
  "requirements.txt",
  "requirements-dev.txt",
  "dev-requirements.txt",
  "setup.cfg",
  "setup.py",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
] as const;

function extractMypyVersion(line: string): string | undefined {
  const match = line.match(/\bmypy\s*(?:[<>=!~]=?|\^)?\s*["']?(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

function getNextMypyPerformanceMilestone(version: {
  major?: number;
  minor?: number;
  patch?: number;
}): { target: string; why: string } | undefined {
  const { major, minor, patch } = version;
  if (major !== 1 || minor === undefined) {
    return undefined;
  }

  if (minor < 13) {
    return {
      target: "1.13",
      why: "mypy 1.13 includes performance improvements in type-checking speed.",
    };
  }

  if (minor < 15) {
    return {
      target: "1.15",
      why: "mypy 1.15 includes further performance improvements in type-checking speed.",
    };
  }

  if (minor === 18 && (patch === undefined || patch <= 0)) {
    return {
      target: "1.18.1",
      why: "mypy 1.18.1 includes performance improvements in type-checking speed.",
    };
  }

  return undefined;
}

function findLineIndex(text: string, predicate: (line: string) => boolean): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i]!)) {
      return i;
    }
  }
  return -1;
}

export async function collectMypyMilestoneDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const diagnostics: Diagnostic[] = [];

  for (const fileName of dependencyFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }

    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    let detectedLine = -1;
    let detectedVersion: string | undefined;

    if (fileName === "poetry.lock") {
      const lines = text.split("\n");
      let inMypyBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "[[package]]") {
          inMypyBlock = false;
          continue;
        }
        if (/^name\s*=\s*["']mypy["']\s*$/.test(line.trim())) {
          inMypyBlock = true;
          continue;
        }
        if (inMypyBlock) {
          const versionMatch = /^version\s*=\s*["'](\d+\.\d+(?:\.\d+)?)/.exec(line.trim());
          if (versionMatch) {
            detectedVersion = versionMatch[1];
            detectedLine = i;
            break;
          }
          if (/^name\s*=/.test(line.trim())) {
            inMypyBlock = false;
          }
        }
      }
    } else {
      detectedLine = findLineIndex(text, (line) => {
        const version = extractMypyVersion(line);
        if (version) {
          detectedVersion = version;
          return true;
        }
        return false;
      });
    }

    if (detectedLine >= 0 && detectedVersion) {
      const parsed = parseSemverLikeVersionSpec(detectedVersion);
      const milestone = getNextMypyPerformanceMilestone(parsed);
      if (milestone) {
        diagnostics.push(
          buildRepositoryDiagnostic(repository, meta, {
            location: {
              path: fileName,
              line: detectedLine + 1,
              column: 1,
            },
            message: `Repository is on mypy ${detectedVersion}, below the ${milestone.target} speed milestone.`,
            why: milestone.why,
            suggestion: `If upgrading is feasible, move mypy from ${detectedVersion} to at least ${milestone.target} as the next speed milestone.`,
            measurementHint: "Compare type-check times before and after upgrading mypy.",
            aiHandoff: `Review ${fileName} and upgrade mypy from ${detectedVersion} to at least ${milestone.target}.`,
            score: 45,
          }),
        );
      }
      break;
    }
  }

  return diagnostics;
}
