import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "pdm-without-use-uv",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/pdm-without-use-uv.md",
} satisfies RuleMeta;

const pdmConfigFileNames = ["pyproject.toml", "pdm.toml"] as const;

function pdmConfigLocation(text: string): { line: number; column: number } | undefined {
  const patterns = [/\[tool\.pdm\]/i, /^\[pdm\]/im];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const before = text.slice(0, Math.max(0, match.index));
      const lines = before.split("\n");
      return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
    }
  }
  return undefined;
}

export async function collectPdmWithoutUseUvDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.pdm.usesPdm || repository.pdm.usesUv) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);
  let location: SourceLocation | undefined;

  for (const fileName of pdmConfigFileNames) {
    const configPath = context.resolve(fileName);
    if (!(await context.pathExists(configPath))) {
      continue;
    }
    const configText = await context.readTextFileOrWarn(configPath);
    if (!configText) {
      continue;
    }

    const found = pdmConfigLocation(configText);
    if (found) {
      location = { path: fileName, line: found.line, column: found.column };
      break;
    }
  }

  location ??= { path: "pyproject.toml", line: 1, column: 1 };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: 'Repository uses PDM without "use_uv = true" configured.',
      why: "PDM can use uv for dependency resolution and installation through its use_uv configuration. This speeds up lock operations and package installation. PDM's build backend alone does not imply use of the PDM package manager.",
      suggestion:
        'Install uv and run "pdm config --local use_uv true", which writes use_uv = true to pdm.toml.',
      measurementHint: "Compare pdm lock and install times before and after enabling use_uv.",
      aiHandoff:
        'Review PDM uv-backend compatibility, install uv, and run "pdm config --local use_uv true" to enable the backend in pdm.toml.',
      score: 46,
    }),
  ];
}
