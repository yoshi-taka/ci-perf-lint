import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-pydantic-v2",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-pydantic-v2.md",
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

// Patterns that indicate pydantic v1 is pinned/requested.
const directV1Patterns = [
  /\bpydantic\s*[<>=!~]=?\s*["']?1\b/i,
  /\bpydantic\s*==\s*["']?1\b/i,
  /\bpydantic\s*~?=\s*["']?1\b/i,
  /\bpydantic\s*=\s*["'][^"']*1[^"']*["']/i,
] as const;

function findLineIndex(text: string, predicate: (line: string) => boolean): number {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (predicate(lines[i]!)) {
      return i;
    }
  }
  return -1;
}

export async function collectPreferPydanticV2Diagnostics(
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

    if (fileName === "poetry.lock") {
      const lines = text.split("\n");
      let inPydanticBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.trim() === "[[package]]") {
          inPydanticBlock = false;
          continue;
        }
        if (/^name\s*=\s*["']pydantic["']\s*$/.test(line.trim())) {
          inPydanticBlock = true;
          continue;
        }
        if (inPydanticBlock && /^version\s*=\s*["']1\./.test(line.trim())) {
          detectedLine = i;
          break;
        }
        if (inPydanticBlock && /^name\s*=/.test(line.trim())) {
          inPydanticBlock = false;
        }
      }
    } else {
      detectedLine = findLineIndex(text, (line) =>
        directV1Patterns.some((pattern) => pattern.test(line)),
      );
    }

    if (detectedLine >= 0) {
      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: fileName,
            line: detectedLine + 1,
            column: 1,
          },
          message: `Pydantic v1 is pinned or requested in ${fileName}.`,
          why: "Pydantic v2 is up to 50x faster and uses less memory. The `pydantic.v1` shim lets you migrate incrementally.",
          suggestion:
            "Migrate to Pydantic v2. If you need v1 compatibility temporarily, use the `pydantic.v1` compatibility shim after upgrading.",
          measurementHint: "Profile model validation throughput before and after migration.",
          aiHandoff: `Review ${fileName} and upgrade pydantic to ^2.0. Address any breaking changes using the migration guide at https://docs.pydantic.dev/latest/migration/.`,
          score: 50,
        }),
      );
      break;
    }
  }

  return diagnostics;
}
