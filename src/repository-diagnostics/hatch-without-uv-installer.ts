import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "hatch-without-uv-installer",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/hatch-without-uv-installer.md",
} satisfies RuleMeta;

const hatchConfigFileNames = ["pyproject.toml", "hatch.toml"] as const;

function hatchConfigLocation(text: string): { line: number; column: number } | undefined {
  const patterns = [/\[tool\.hatch\.env\]/i, /^\[env\]/im, /\[tool\.hatch\]/i];
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

export async function collectHatchWithoutUvInstallerDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  if (!repository.hatch.usesHatch || repository.hatch.usesUvInstaller) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, _warnings ?? []);
  let location: SourceLocation | undefined;

  for (const fileName of hatchConfigFileNames) {
    const configPath = context.resolve(fileName);
    if (!(await context.pathExists(configPath))) {
      continue;
    }
    const configText = await context.readTextFileOrWarn(configPath);
    if (!configText) {
      continue;
    }

    const found = hatchConfigLocation(configText);
    if (found) {
      location = { path: fileName, line: found.line, column: found.column };
      break;
    }
  }

  location ??= { path: "pyproject.toml", line: 1, column: 1 };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location,
      message: 'Repository uses Hatch without installer = "uv" configured.',
      why: 'Hatch can use uv for dependency installation by setting installer = "uv" in [tool.hatch.env] in pyproject.toml or [env] in hatch.toml. This speeds up environment creation and package installation with no workflow changes.',
      suggestion:
        'Add "installer = \\"uv\\"" to the [tool.hatch.env] section of pyproject.toml (or [env] section of hatch.toml).',
      measurementHint:
        "Compare hatch environment creation time before and after adding the uv installer setting.",
      aiHandoff:
        'Review the project\'s hatch config and add installer = "uv" to [tool.hatch.env] in pyproject.toml or [env] in hatch.toml.',
      score: 46,
    }),
  ];
}
