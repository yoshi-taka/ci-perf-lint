import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const recommendSwcOverBabelMeta = {
  id: "recommend-swc-over-babel",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/recommend-swc-over-babel.md",
} satisfies RuleMeta;

function buildSkipReasons(babel: RepositorySignals["babel"]): string[] {
  const reasons: string[] = [];
  if (babel.hasCustomPlugins) {
    reasons.push("custom Babel plugins detected");
  }
  if (babel.hasMacros) {
    reasons.push("babel-plugin-macros in use");
  }
  if (babel.hasDecorators) {
    reasons.push("decorators (possibly legacy) in use");
  }
  if (babel.hasEmotionPlugin) {
    reasons.push("emotion Babel plugin in use");
  }
  if (babel.hasStyledComponentsPlugin) {
    reasons.push("styled-components Babel plugin in use");
  }
  if (babel.hasRelayPlugin) {
    reasons.push("relay Babel plugin in use");
  }
  if (babel.hasI18nPlugin) {
    reasons.push("i18n extraction plugin in use");
  }
  if (babel.hasCoreJs) {
    reasons.push("core-js / useBuiltIns detected");
  }
  if (babel.hasLegacyBrowserTargets) {
    reasons.push("legacy browser targets detected");
  }
  return reasons;
}

export async function collectRecommendSwcOverBabelDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const babel = repository.babel;

  if (!babel.usesBabel) {
    return [];
  }

  const skipReasons = buildSkipReasons(babel);
  if (skipReasons.length > 0) {
    return [];
  }

  const packageJsonEntry = await context.loadPackageJson();
  const relativePath = packageJsonEntry.path.startsWith(repoRoot)
    ? packageJsonEntry.path.slice(repoRoot.length + 1)
    : packageJsonEntry.path;

  const configHint =
    babel.hasConfig && babel.configFileName ? `Detected config: ${babel.configFileName}.` : "";

  return [
    buildRepositoryDiagnostic(repository, recommendSwcOverBabelMeta, {
      location: {
        path: relativePath,
        line: 1,
        column: 1,
      },
      message: `Babel is used but SWC could provide faster builds.`,
      why: "SWC is a Rust-based compiler that offers significantly faster transpilation than Babel. For projects using only standard presets (preset-env, preset-typescript, preset-react), SWC can often be a drop-in replacement.",
      suggestion: `Consider migrating from Babel to SWC. ${configHint} SWC provides native TypeScript support and faster builds without requiring Babel's plugin ecosystem for standard use cases.`,
      measurementHint: "Compare transpilation time and output compatibility between Babel and SWC.",
      aiHandoff: `Review ${babel.configFileName ?? "Babel config"} and package.json for SWC compatibility. Replace @babel/core with @swc/core and adjust config syntax. Do not change build output behavior.`,
      score: 40,
    }),
  ];
}
