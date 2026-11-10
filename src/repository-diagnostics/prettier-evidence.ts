import path from "node:path";
import type { SourceLocation } from "../types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";

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

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

/** Point at the Prettier dependency or the first visible config file. */
export async function findPrettierEvidenceLocation(
  repoRoot: string,
  context: RepositoryScanContext,
): Promise<SourceLocation> {
  const packageJsonEntry = await context.loadPackageJson();
  if (packageJsonEntry.text) {
    const match = /"prettier"\s*:/.exec(packageJsonEntry.text);
    if (match) {
      const pos = lineColumnForIndex(packageJsonEntry.text, match.index);
      return {
        path:
          path.relative(repoRoot, packageJsonEntry.path).replace(/\\/g, "/") ||
          path.basename(packageJsonEntry.path),
        line: pos.line,
        column: pos.column,
      };
    }
  }

  for (const fileName of prettierConfigFileNames) {
    if (await context.pathExists(context.resolve(fileName))) {
      return { path: fileName, line: 1, column: 1 };
    }
  }

  return { path: "package.json", line: 1, column: 1 };
}
