import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "pyramid-config-scan-unrestricted",
  severity: "warning" as const,
  confidence: "medium" as const,
  docsPath: "docs/rules/pyramid-config-scan-unrestricted.md",
} satisfies RuleMeta;

const likelyUnwantedDirNames = new Set([
  "tests",
  "test",
  "scripts",
  "batch",
  "jobs",
  "tasks",
  "cron",
  "migrations",
  "alembic",
  "frontend",
  "client",
  "assets",
  "static",
  "dist",
  "build",
  "node_modules",
  "docs",
  "examples",
  "fixtures",
]);

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function extractCallBody(source: string, startIndex: number): string | undefined {
  let depth = 0;
  let i = startIndex;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    } else if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          break;
        }
        i++;
      }
    }
    i++;
  }
  return undefined;
}

function firstStringArgument(callBody: string): string | undefined {
  const match = callBody.match(/^\(\s*(["'])(.*?)\1/);
  if (match) {
    return match[2];
  }
  return undefined;
}

export async function collectPyramidConfigScanDiagnostics(
  repoRoot: string,
  _repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const pyFiles = await context.walkFiles(".", {
    cacheKey: "pyramid-py-files",
    ignoredDirectories: new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".tox"]),
    include: (relativePath) => relativePath.endsWith(".py"),
  });

  const diagnostics: Diagnostic[] = [];

  for (const relativePath of pyFiles) {
    const filePath = context.resolve(relativePath);
    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    const scanRegex = /config\.scan\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = scanRegex.exec(text)) !== null) {
      const callStartIndex = match.index;
      const callBody = extractCallBody(text, callStartIndex + "config.scan".length);
      if (!callBody) {
        continue;
      }

      if (/\bignore\s*=/.test(callBody)) {
        continue;
      }

      const targetArg = firstStringArgument(callBody);
      const scanTarget = targetArg ?? ".";

      const scanTargetAbsolute = path.isAbsolute(scanTarget)
        ? scanTarget
        : path.join(path.dirname(filePath), scanTarget);

      if (!scanTargetAbsolute.startsWith(repoRoot)) {
        continue;
      }

      const unwantedChildren: string[] = [];
      try {
        const entries = await context.readDirectoryEntries(scanTargetAbsolute);
        for (const entry of entries) {
          if (entry.isDirectory() && likelyUnwantedDirNames.has(entry.name)) {
            unwantedChildren.push(entry.name);
          }
        }
      } catch {
        continue;
      }

      if (unwantedChildren.length === 0) {
        continue;
      }

      const { line, column } = lineColumnForIndex(text, callStartIndex);

      diagnostics.push(
        buildRepositoryDiagnostic(_repository, meta, {
          location: {
            path: relativePath,
            line,
            column,
          },
          message: `config.scan call lacks an ignore filter and the scan target "${scanTarget}" contains likely non-runtime directories: ${unwantedChildren.join(", ")}.`,
          why: "Pyramid's config.scan recursively imports every Python file under the target directory. Without an ignore filter, test utilities, scripts, migrations, and frontend assets may be imported during application startup, increasing startup time and memory use.",
          suggestion: `Add an ignore= argument to this config.scan call to exclude directories that do not contain runtime application code (for example: ignore=['^tests', '^scripts', '^migrations', '^frontend', '^docs']).`,
          measurementHint:
            "Restart the application and measure cold-start time and memory footprint before and after adding the ignore filter.",
          aiHandoff: `Update ${relativePath} to add an ignore= parameter to the config.scan call on line ${line}, preserving unrelated behavior.`,
          score: 40,
        }),
      );
    }
  }

  return diagnostics;
}
