import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "tailwind-content-config",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/tailwind-content-config.md",
} satisfies RuleMeta;

const tailwindConfigFileNames = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.cts",
  "tailwind.config.mts",
] as const;

const mdxDependencyNames = [
  "@mdx-js/react",
  "@mdx-js/mdx",
  "@mdx-js/loader",
  "mdx-bundler",
  "next-mdx-remote",
  "@next/mdx",
  "mdx",
] as const;

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findEvidenceLocation(
  text: string,
  pattern: RegExp,
): { line: number; column: number } | undefined {
  const match = pattern.exec(text);
  if (match) {
    return lineColumnForIndex(text, match.index);
  }
  return undefined;
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

function hasContentProperty(configText: string): boolean {
  return /\bcontent\s*[:=]\s*/.test(configText);
}

function hasBroadGlob(configText: string): boolean {
  return /["']\.\/\*\*\/\*["']/.test(configText);
}

function hasNodeModulesGlob(configText: string): boolean {
  return /["'][^"']*node_modules[^"']*["']/.test(configText);
}

function hasMdxDependency(packageJsonText: string): boolean {
  return mdxDependencyNames.some((name) =>
    new RegExp(`["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(packageJsonText),
  );
}

function shouldSkipContentMissingCheck(
  repository: RepositorySignals,
  packageJsonText: string | undefined,
): boolean {
  if (repository.frameworks.usesStorybook) {
    return true;
  }
  if (packageJsonText && hasMdxDependency(packageJsonText)) {
    return true;
  }
  return false;
}

function hasScopedNodeModulesGlob(configText: string): boolean {
  return /["'][^"']*node_modules\/@[^"']+["']/.test(configText);
}

export async function collectTailwindContentConfigDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const { tailwind } = repository;
  if (!tailwind.usesTailwind) {
    return [];
  }

  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJsonText = packageJsonEntry.text;
  const skipContentMissing = shouldSkipContentMissingCheck(repository, packageJsonText);
  const diagnostics: Diagnostic[] = [];

  for (const fileName of tailwindConfigFileNames) {
    const configPath = context.resolve(fileName);
    if (!(await context.pathExists(configPath))) {
      continue;
    }

    const configText = await context.readTextFileOrWarn(configPath);
    if (!configText) {
      continue;
    }

    const relativePath = normalizeRelativePath(repoRoot, configPath);
    const hasContent = hasContentProperty(configText);

    if (!hasContent && !skipContentMissing) {
      const location = findEvidenceLocation(
        configText,
        /\bmodule\.exports\s*=|export\s+default\b/,
      ) ?? { line: 1, column: 1 };

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `Tailwind config "${fileName}" is missing a content configuration.`,
          why: "Without a content section, Tailwind cannot determine which files contain utility classes. This may cause all utilities to be included in the output CSS or cause build failures depending on the Tailwind version.",
          suggestion:
            "Add a content section listing the paths to your template files, e.g. content: ['./src/**/*.{html,js,ts,jsx,tsx}'].",
          measurementHint:
            "Check the output CSS file size before and after adding content paths. It should shrink to only include used utilities.",
          aiHandoff: `Update ${relativePath} to add a content property that covers the project's template files. Keep other config unchanged.`,
          score: 70,
        }),
      );
    }

    if (hasContent && hasBroadGlob(configText)) {
      const location = findEvidenceLocation(configText, /["']\.\/\*\*\/\*["']/) ?? {
        line: 1,
        column: 1,
      };

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: `Tailwind config "${fileName}" uses a broad glob pattern "./**/*" in content.`,
          why: "A broad content glob forces Tailwind to scan every file in the repository, which can slow down the CSS build step and increase CI time.",
          suggestion:
            "Restrict the content glob to specific directories and file extensions, e.g. './src/**/*.{html,js,ts,jsx,tsx}'.",
          measurementHint:
            "Compare Tailwind build time before and after narrowing the content glob.",
          aiHandoff: `Update the content globs in ${relativePath} to target only the directories and file types that actually contain Tailwind classes.`,
          score: 40,
        }),
      );
    }

    if (hasContent && hasNodeModulesGlob(configText)) {
      const location = findEvidenceLocation(configText, /["'][^"']*node_modules[^"']*["']/) ?? {
        line: 1,
        column: 1,
      };
      const isScoped = hasScopedNodeModulesGlob(configText);

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: relativePath, line: location.line, column: location.column },
          message: isScoped
            ? `Tailwind config "${fileName}" includes scoped node_modules packages in content.`
            : `Tailwind config "${fileName}" includes node_modules in content.`,
          why: isScoped
            ? "Scanning specific scoped packages from node_modules may be necessary for external UI libraries, but adds file I/O overhead."
            : "Scanning node_modules for Tailwind classes adds unnecessary file I/O and can significantly slow down the CSS build.",
          suggestion: isScoped
            ? "Verify that each listed package is required. If only a few components are needed, consider copying them into your source tree instead."
            : "Remove node_modules from content and restrict globs to your own source directories. If you need to scan a specific package, list it explicitly.",
          measurementHint:
            "Compare Tailwind build time before and after removing node_modules from content.",
          aiHandoff: isScoped
            ? `Review the scoped node_modules packages in the content section of ${relativePath}. Keep only packages that provide Tailwind classes used in your project.`
            : `Remove node_modules references from the content section in ${relativePath} and restrict to source directories only.`,
          score: isScoped ? 30 : 50,
        }),
      );
    }

    break;
  }

  return diagnostics;
}
