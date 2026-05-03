import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const tsLoaderForkTsCheckerMeta = {
  id: "ts-loader-fork-ts-checker",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/ts-loader-fork-ts-checker.md",
} satisfies RuleMeta;

const webpackConfigPatterns = [
  "webpack.config.js",
  "webpack.config.ts",
  "webpack.config.mjs",
  "webpack.config.cjs",
];

function hasTsLoader(configContent: string): boolean {
  return /loader\s*:\s*["']ts-loader["']/.test(configContent);
}

function hasTranspileOnly(configContent: string): boolean {
  return /transpileOnly\s*:\s*true/.test(configContent);
}

function hasHappyPackMode(configContent: string): boolean {
  return /happyPackMode\s*:\s*true/.test(configContent);
}

function hasForkTsCheckerWebpackPlugin(configContent: string): boolean {
  return /ForkTsCheckerWebpackPlugin|fork-ts-checker-webpack-plugin/.test(configContent);
}

function findTsLoaderLine(configContent: string): number {
  const lines = configContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/loader\s*:\s*["']ts-loader["']/.test(lines[i]!)) {
      return i + 1;
    }
  }
  return 1;
}

export async function collectTsLoaderForkTsCheckerDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  let configContent = "";
  let configPath = "";
  for (const pattern of webpackConfigPatterns) {
    const content = await context.readTextFileOrWarn(context.resolve(pattern));
    if (content) {
      configContent = content;
      configPath = pattern;
      break;
    }
  }

  if (!configContent) {
    return [];
  }

  if (!hasTsLoader(configContent)) {
    return [];
  }

  if (hasForkTsCheckerWebpackPlugin(configContent)) {
    return [];
  }

  const hasTranspileOnlyOption = hasTranspileOnly(configContent);
  const hasHappyPackModeOption = hasHappyPackMode(configContent);

  if (!hasTranspileOnlyOption && !hasHappyPackModeOption) {
    return [];
  }

  const line = findTsLoaderLine(configContent);

  return [
    buildRepositoryDiagnostic(repository, tsLoaderForkTsCheckerMeta, {
      location: {
        path: configPath,
        line,
        column: 1,
      },
      message: `ts-loader is used with transpileOnly or happyPackMode but fork-ts-checker-webpack-plugin is missing.`,
      why: "When ts-loader runs with transpileOnly:true or happyPackMode:true, type checking is skipped during bundling. Without fork-ts-checker-webpack-plugin, type errors will only surface at test time or not at all, delaying feedback in CI.",
      suggestion: `Add fork-ts-checker-webpack-plugin to your webpack plugins in ${configPath}. This runs type checking in a separate process while keeping fast builds.`,
      measurementHint:
        "Compare CI feedback time with and without fork-ts-checker-webpack-plugin. Type errors should be caught earlier without slowing down the build.",
      aiHandoff: `Add ForkTsCheckerWebpackPlugin to plugins array in ${configPath}. Ensure it is configured to run type checking in parallel with the build.`,
      score: 50,
    }),
  ];
}
