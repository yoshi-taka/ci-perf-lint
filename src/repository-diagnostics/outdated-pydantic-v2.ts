import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  outdatedPydanticV2MeasurementHint,
  outdatedPydanticV2Message,
  outdatedPydanticV2Suggestion,
  outdatedPydanticV2Why,
  pydanticV2SpecIsOutdated,
} from "../rules/shared/pydantic-versions.ts";

const meta = {
  id: "outdated-pydantic-v2",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/outdated-pydantic-v2.md",
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

const pydanticRequirementPattern = /\bpydantic(?![-_])(?:\[[^\]]*\])?\s*(.*)$/i;

interface DetectedSpec {
  spec: string;
  line: number;
  column: number;
}

function candidateSpecs(rest: string): string[] {
  const quoted = [...rest.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
  if (quoted.length > 0) {
    return quoted;
  }
  const cleaned = rest
    .replace(/[{}'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,]+$/, "");
  return cleaned ? [cleaned] : [];
}

function detectPoetryLock(text: string): DetectedSpec | undefined {
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
    if (inPydanticBlock && /^name\s*=/.test(line.trim())) {
      inPydanticBlock = false;
      continue;
    }
    if (inPydanticBlock) {
      const versionMatch = /^version\s*=\s*["']([^"']+)["']/.exec(line.trim());
      if (versionMatch?.[1] && pydanticV2SpecIsOutdated(versionMatch[1])) {
        return { spec: versionMatch[1], line: i + 1, column: 1 };
      }
    }
  }
  return undefined;
}

function detectInText(fileName: string, text: string): DetectedSpec | undefined {
  if (fileName === "poetry.lock") {
    return detectPoetryLock(text);
  }

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const nameMatch = pydanticRequirementPattern.exec(line);
    if (!nameMatch) {
      continue;
    }
    for (const spec of candidateSpecs(nameMatch[1]!)) {
      if (pydanticV2SpecIsOutdated(spec)) {
        return { spec, line: i + 1, column: nameMatch.index + 1 };
      }
    }
  }
  return undefined;
}

export async function collectOutdatedPydanticV2Diagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  for (const fileName of dependencyFileNames) {
    const filePath = context.resolve(fileName);
    if (!(await context.pathExists(filePath))) {
      continue;
    }

    const text = await context.readTextFileOrWarn(filePath);
    if (!text) {
      continue;
    }

    const detected = detectInText(fileName, text);
    if (!detected) {
      continue;
    }

    const location: SourceLocation = {
      path: fileName,
      line: detected.line,
      column: detected.column,
    };
    return [
      buildRepositoryDiagnostic(repository, meta, {
        location,
        message: outdatedPydanticV2Message(detected.spec, fileName),
        why: outdatedPydanticV2Why,
        suggestion: outdatedPydanticV2Suggestion,
        measurementHint: outdatedPydanticV2MeasurementHint,
        aiHandoff: `Review ${fileName} at ${location.line}:${location.column} and raise the pydantic constraint to >=2.13 (2.13.x or newer). Re-run model import and validation tests to confirm behavior is unchanged.`,
        score: 49,
      }),
    ];
  }

  return [];
}
