import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import {
  craDependencyNames,
  packageJsonDependencyVersionSpec,
  packageJsonHasDependency,
  parseSemverLikeVersionSpec,
} from "../repository-package-helpers.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const recommendRspackOverWebpackMeta = {
  id: "recommend-rspack-over-webpack",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/recommend-rspack-over-webpack.md",
} satisfies RuleMeta;

function findCraDependency(packageJson: Record<string, unknown>): string | undefined {
  return craDependencyNames.find((name) => packageJsonHasDependency(packageJson, name));
}

function dependencyLine(packageJsonText: string, dependency: string): number {
  const index = packageJsonText.split("\n").findIndex((line) => line.includes(`"${dependency}"`));
  return index >= 0 ? index + 1 : 1;
}

const webpackConfigPatterns = [
  "webpack.config.js",
  "webpack.config.ts",
  "webpack.config.mjs",
  "webpack.config.cjs",
];

function hasCustomPlugins(configContent: string): boolean {
  const pluginPatterns = [
    /plugins\s*:\s*\[/,
    /new\s+\w+Plugin\s*\(/,
    /\.use\s*\(/,
    /apply\s*\(\s*compiler/,
  ];
  return pluginPatterns.some((pattern) => pattern.test(configContent));
}

function hasCompilerCompilationHooks(configContent: string): boolean {
  const hookPatterns = [
    /compiler\.hooks\./,
    /compilation\.hooks\./,
    /\.tap\s*\(/,
    /\.tapPromise\s*\(/,
    /\.tapAsync\s*\(/,
    /emit\s*:/,
    /afterEmit\s*:/,
    /done\s*:/,
    /compile\s*:/,
    /thisCompilation\s*:/,
    /make\s*:/,
    /shouldEmit\s*:/,
  ];
  return hookPatterns.some((pattern) => pattern.test(configContent));
}

function hasDeepDevServerOrResolverConfig(configContent: string): boolean {
  const devServerPatterns = [
    /devServer\s*:\s*\{[^}]*setup\s*:/,
    /devServer\s*:\s*\{[^}]*before\s*:/,
    /devServer\s*:\s*\{[^}]*after\s*:/,
    /devServer\s*:\s*\{[^}]*onListening\s*:/,
    /devServer\s*:\s*\{[^}]*middleware\s*:/,
    /devServer\s*:\s*\{[^}]*setupMiddlewares\s*:/,
    /devServer\s*:\s*\{[^}]*onBeforeSetupMiddleware\s*:/,
    /devServer\s*:\s*\{[^}]*onAfterSetupMiddleware\s*:/,
    /devServer\.app/,
    /devServer\.middleware/,
  ];
  const resolverPatterns = [
    /resolve\s*:\s*\{[^}]*plugins\s*:/,
    /resolver\.factory\.hook/,
    /new\s+ResolverPlugin/,
    /\.resolve\.toModules/,
  ];
  return [...devServerPatterns, ...resolverPatterns].some((pattern) => pattern.test(configContent));
}

export async function collectRecommendRspackOverWebpackDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;

  if (!packageJson) {
    return [];
  }

  const relativePath = packageJsonEntry.path.startsWith(repoRoot)
    ? packageJsonEntry.path.slice(repoRoot.length + 1)
    : packageJsonEntry.path;

  // CRA hides its webpack config, so the custom-plugin checks below cannot see
  // it. Give CRA repos their own guidance instead of a drop-in rspack suggestion.
  const craDependency = findCraDependency(packageJson);
  if (craDependency) {
    return [
      buildRepositoryDiagnostic(repository, recommendRspackOverWebpackMeta, {
        location: {
          path: relativePath,
          line: dependencyLine(packageJsonEntry.text ?? "", craDependency),
          column: 1,
        },
        message: `${craDependency} is used; consider migrating off Create React App to Vite or Rsbuild.`,
        why: `Create React App relies on an internal webpack build that cannot be swapped for rspack through a normal webpack config. The React team deprecated Create React App for new apps on 2025-02-14 (https://react.dev/blog/2025/02/14/sunsetting-create-react-app). The React blog links a Vite Create React App migration guide (https://www.robinwieruch.de/vite-create-react-app/) and Rsbuild publishes one too (https://rsbuild.dev/guide/migration/cra). Visible evidence: ${craDependency} in package.json.`,
        suggestion: `Migrate from ${craDependency} to Vite or Rsbuild using their Create React App migration guides. Keep eslint-config-prettier style formatting separate, and verify environment variables, public assets, aliases, and polyfills after the switch.`,
        measurementHint:
          "Compare dev server startup time, hot update latency, production build time, and bundle size before and after migrating off Create React App.",
        aiHandoff: `Review the ${craDependency} setup (including CRACO or rescripts overrides) and migrate to Vite or Rsbuild with the published Create React App guide. Preserve build output behavior and required checks.`,
        score: 44,
      }),
    ];
  }

  const webpackVersionSpec = packageJsonDependencyVersionSpec(packageJson, "webpack");
  if (!webpackVersionSpec) {
    return [];
  }

  const parsed = parseSemverLikeVersionSpec(webpackVersionSpec);
  if (parsed.major !== 5) {
    return [];
  }

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

  const skipReasons: string[] = [];
  if (hasCustomPlugins(configContent)) {
    skipReasons.push("custom webpack plugins detected");
  }
  if (hasCompilerCompilationHooks(configContent)) {
    skipReasons.push("compiler/compilation hooks in use");
  }
  if (hasDeepDevServerOrResolverConfig(configContent)) {
    skipReasons.push("deep devServer or resolver customization");
  }

  if (skipReasons.length > 0) {
    return [];
  }

  return [
    buildRepositoryDiagnostic(repository, recommendRspackOverWebpackMeta, {
      location: {
        path: relativePath,
        line: 1,
        column: 1,
      },
      message: `webpack ${webpackVersionSpec} is used but rspack could provide faster builds.`,
      why: "rspack is a webpack-compatible bundler built with Rust. It offers significantly faster build times, HMR, and production builds while maintaining high webpack API compatibility.",
      suggestion: `Consider migrating from webpack to rspack. Detected config: ${configPath}. rspack can often be used as a drop-in replacement with minimal configuration changes.`,
      measurementHint:
        "Compare build time, HMR speed, and output bundle size between webpack and rspack.",
      aiHandoff: `Review ${configPath} and package.json for rspack compatibility. Replace webpack with @rspack/core and adjust config syntax where needed. Do not change build output behavior.`,
      score: 40,
    }),
  ];
}
