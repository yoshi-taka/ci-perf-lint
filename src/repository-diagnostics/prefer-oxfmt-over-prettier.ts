import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta, SourceLocation } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "prefer-oxfmt-over-prettier",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-oxfmt-over-prettier.md",
} satisfies RuleMeta;

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

export async function collectPreferOxfmtOverPrettierDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { usesPrettier, usesOxfmt, pluginNames } = repository.prettier;
  if (!usesPrettier || usesOxfmt) {
    return [];
  }

  const severity = pluginNames.length > 0 ? "suggestion" : "warning";
  const pluginNote =
    pluginNames.length > 0
      ? `Visible Prettier plugins may need migration review: ${pluginNames.join(", ")}.`
      : "No visible Prettier plugins were detected at the repository root.";

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  let location: SourceLocation | undefined;

  const prettierDepPattern = /"prettier"\s*:/g;
  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text) {
    const match = prettierDepPattern.exec(packageJsonEntry.text);
    if (match) {
      const pos = lineColumnForIndex(packageJsonEntry.text, match.index);
      location = {
        path: normalizeRelativePath(repoRoot, packageJsonEntry.path),
        line: pos.line,
        column: pos.column,
      };
    }
  }

  if (!location) {
    const prettierConfigFileNames = [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.json5",
      ".prettierrc.yaml",
      ".prettierrc.yml",
      ".prettierrc.js",
      ".prettierrc.cjs",
      ".prettierrc.mjs",
      ".prettierrc.toml",
    ];
    for (const fileName of prettierConfigFileNames) {
      const configPath = context.resolve(fileName);
      if (await context.pathExists(configPath)) {
        location = { path: fileName, line: 1, column: 1 };
        break;
      }
    }
  }

  location ??= { path: "package.json", line: 1, column: 1 };

  return [
    buildRepositoryDiagnostic(repository, meta, {
      severity,
      location,
      message: "Repository appears to use Prettier without visible Oxfmt adoption.",
      why: `Oxfmt is positioned as a high-performance Prettier-compatible formatter for the JavaScript ecosystem, and its CLI is designed to fit existing Prettier-style format/check workflows with minimal script, CI, and hook changes. The official Prettier migration guide documents \`oxfmt --migrate=prettier\`, config migration, script and CI updates, plugin limitations, and output differences such as print width defaults. ${pluginNote}`,
      suggestion:
        severity === "warning"
          ? "Read OXC's 'Migrate from Prettier' guide first, then consider using `oxfmt --migrate=prettier` and replacing the current Prettier entrypoint with Oxfmt to reduce formatter runtime while keeping a drop-in-style migration path."
          : "Read OXC's 'Migrate from Prettier' guide first, then evaluate Oxfmt as a faster drop-in-style formatter for this path while verifying Prettier plugin coverage and config compatibility before replacing Prettier.",
      measurementHint:
        "Compare formatting step duration and diff output on the same file set before changing CI defaults.",
      aiHandoff:
        severity === "warning"
          ? "Start with OXC's 'Migrate from Prettier' guide, review repository formatter scripts, dependencies, CI entrypoints, and hook integrations together, and test whether `oxfmt --migrate=prettier` plus Oxfmt can replace the current Prettier path with equivalent output for the repository's formatted files."
          : "Start with OXC's 'Migrate from Prettier' guide, review repository formatter scripts, visible Prettier plugins, config usage, and hook integrations together, and only replace Prettier with Oxfmt after confirming equivalent coverage for the current formatting path.",
      score: severity === "warning" ? 48 : 33,
    }),
  ];
}
