import type { RepositoryDiagnosticCollector } from "./collector-types.ts";
import { gates } from "./gates.ts";
import {
  collectExplicitImportExtensionDiagnostics,
  collectRestrictedImportRepositoryDiagnostics,
} from "./imports.ts";
import { collectLargeBarrelFileDiagnostics } from "./large-barrel.ts";
import { collectLargeJestSnapshotDiagnostics } from "./jest-snapshot.ts";
import { collectNpmCiOverNpmInstallDiagnostics } from "./npm-ci-over-npm-install.ts";
import { collectPackageJsonNodeRunDiagnostics } from "./package-json-node-run.ts";
import { collectSetupNodeCacheDependencyPathUnsetDiagnostics } from "./setup-node-cache-dependency-path-unset.ts";
import { collectTypeScriptMilestoneDiagnostics } from "./typescript-milestone.ts";
import { collectAvoidEslintPluginPrettierDiagnostics } from "./avoid-eslint-plugin-prettier.ts";
import { collectAvoidPrettierEslintDiagnostics } from "./avoid-prettier-eslint.ts";
import { collectPreferEslintPluginImportXDiagnostics } from "./prefer-eslint-plugin-import-x.ts";
import { collectPreferJest30ForJest29Diagnostics } from "./prefer-jest-30-for-jest-29.ts";
import { collectPreferLefthookForComplexGitHooksDiagnostics } from "./prefer-lefthook-for-complex-git-hooks.ts";
import { collectPreferNextestForHeavyRustTestsDiagnostics } from "./prefer-nextest-for-heavy-rust-tests.ts";
import {
  collectPreferNextjs12MinorPerformanceMilestoneDiagnostics,
  collectPreferNextjs13MinorPerformanceMilestoneDiagnostics,
  collectPreferNextjs14MinorPerformanceMilestoneDiagnostics,
} from "./prefer-nextjs-minor-performance-milestone.ts";
import { collectPreferOxlintOverEslintDiagnostics } from "./prefer-oxlint-over-eslint.ts";
import { collectPreferOxfmtOverPrettierDiagnostics } from "./prefer-oxfmt-over-prettier.ts";
import {
  collectPreferStorybook6MinorPerformanceMilestoneDiagnostics,
  collectPreferStorybook7MinorPerformanceMilestoneDiagnostics,
} from "./prefer-storybook-minor-performance-milestone.ts";
import { collectPreferTailwindV4UpgradeToolDiagnostics } from "./prefer-tailwind-v4-upgrade-tool.ts";
import { collectPreferTurborepoOverNpmWorkspacesDiagnostics } from "./prefer-turborepo-over-npm-workspaces.ts";
import { collectOutdatedHuskyVersionDiagnostics } from "./outdated-husky-version.ts";
import { collectRedundantBootstrapInHuskyHookDiagnostics } from "./redundant-bootstrap-in-husky-hook.ts";
import { collectRecommendWebpack4LatestPatchDiagnostics } from "./recommend-webpack-4-latest-patch.ts";
import { collectRecommendWebpack5LatestPatchDiagnostics } from "./recommend-webpack-5-latest-patch.ts";
import { collectRecommendRspackOverWebpackDiagnostics } from "./recommend-rspack-over-webpack.ts";
import { collectRecommendSwcOverBabelDiagnostics } from "./recommend-swc-over-babel.ts";
import { collectTsLoaderForkTsCheckerDiagnostics } from "./ts-loader-fork-ts-checker.ts";
import { collectTailwindContentConfigDiagnostics } from "./tailwind-content-config.ts";
import { collectRenovateAwsSdkGroupingDiagnostics } from "./renovate-aws-sdk-grouping.ts";
import { collectRenovateCdkDepsGroupingDiagnostics } from "./renovate-cdk-deps-grouping.ts";
import { collectRenovateRebaseWhenDiagnostics } from "./renovate-rebase-when.ts";
import { collectVercelJsonDiagnostics } from "./vercel-json.ts";
import { collectWranglerTomlDiagnostics } from "./wrangler-toml.ts";
import { collectAmplifyYmlDiagnostics } from "./amplify-yml.ts";

export const javascriptDiagnosticCollectors = [
  {
    id: "avoid-eslint-plugin-prettier",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectAvoidEslintPluginPrettierDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "avoid-prettier-eslint",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectAvoidPrettierEslintDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-eslint-plugin-import-x",
    gate: gates.javascriptLinting,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferEslintPluginImportXDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-oxfmt-over-prettier",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferOxfmtOverPrettierDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-oxlint-over-eslint",
    gate: gates.javascriptLinting,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferOxlintOverEslintDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "detected-large-barrel-file",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectLargeBarrelFileDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "npm-ci-over-npm-install",
    gate: gates.javascriptPackageScripts,
    collect: (context) => collectNpmCiOverNpmInstallDiagnostics(context),
  },
  {
    id: "prefer-node-run-over-npm-run",
    gate: gates.javascriptPackageScripts,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPackageJsonNodeRunDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-explicit-import-extensions",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectExplicitImportExtensionDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "large-jest-snapshot",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectLargeJestSnapshotDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "restricted-import-diagnostics",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectRestrictedImportRepositoryDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "setup-node-cache-dependency-path-unset",
    gate: gates.javascriptHeavy,
    collect: (context) => collectSetupNodeCacheDependencyPathUnsetDiagnostics(context),
  },
  {
    id: "prefer-next-typescript-performance-milestone",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectTypeScriptMilestoneDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "recommend-webpack-4-latest-patch",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectRecommendWebpack4LatestPatchDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "recommend-webpack-5-latest-patch",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectRecommendWebpack5LatestPatchDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "prefer-turborepo-over-npm-workspaces",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectPreferTurborepoOverNpmWorkspacesDiagnostics(
        repoRoot,
        repository,
        warnings,
        scanContext,
      ),
  },
  {
    id: "recommend-rspack-over-webpack",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectRecommendRspackOverWebpackDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "recommend-swc-over-babel",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectRecommendSwcOverBabelDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "ts-loader-fork-ts-checker",
    gate: gates.javascriptBuildConfig,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectTsLoaderForkTsCheckerDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "tailwind-content-config",
    gate: gates.javascriptHeavy,
    collect: ({ repoRoot, repository, warnings, scanContext }) =>
      collectTailwindContentConfigDiagnostics(repoRoot, repository, warnings, scanContext),
  },
  {
    id: "renovate-rebase-when-unconfigured",
    gate: gates.renovate,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectRenovateRebaseWhenDiagnostics(repoRoot, repository, workflows, warnings, scanContext),
  },
  {
    id: "renovate-aws-sdk-grouping",
    gate: gates.renovate,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectRenovateAwsSdkGroupingDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "renovate-cdk-deps-grouping",
    gate: gates.renovate,
    collect: ({ repoRoot, repository, workflows, warnings, scanContext }) =>
      collectRenovateCdkDepsGroupingDiagnostics(
        repoRoot,
        repository,
        workflows,
        warnings,
        scanContext,
      ),
  },
  {
    id: "outdated-husky-version",
    gate: gates.husky,
    collect: ({ repoRoot, repository }) =>
      collectOutdatedHuskyVersionDiagnostics(repoRoot, repository),
  },
  {
    id: "prefer-lefthook-for-complex-git-hooks",
    gate: gates.husky,
    collect: ({ repoRoot, repository }) =>
      collectPreferLefthookForComplexGitHooksDiagnostics(repoRoot, repository),
  },
  {
    id: "redundant-bootstrap-in-husky-hook",
    gate: gates.husky,
    collect: ({ repoRoot, repository }) =>
      collectRedundantBootstrapInHuskyHookDiagnostics(repoRoot, repository),
  },
  {
    id: "prefer-jest-30-for-jest-29",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferJest30ForJest29Diagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-nextjs-12-minor-performance-milestone",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferNextjs12MinorPerformanceMilestoneDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-nextjs-13-minor-performance-milestone",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferNextjs13MinorPerformanceMilestoneDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-nextjs-14-minor-performance-milestone",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferNextjs14MinorPerformanceMilestoneDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-storybook-6-minor-performance-milestone",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferStorybook6MinorPerformanceMilestoneDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-storybook-7-minor-performance-milestone",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferStorybook7MinorPerformanceMilestoneDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-tailwind-v4-upgrade-tool",
    gate: gates.javascriptFrameworks,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferTailwindV4UpgradeToolDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "prefer-nextest-for-heavy-rust-tests",
    gate: gates.rust,
    collect: ({ repoRoot, repository, warnings }) =>
      collectPreferNextestForHeavyRustTestsDiagnostics(repoRoot, repository, warnings),
  },
  {
    id: "vercel-json-commands",
    gate: gates.javascriptPackageScripts,
    collect: (context) => collectVercelJsonDiagnostics(context),
  },
  {
    id: "wrangler-toml-commands",
    gate: gates.javascriptPackageScripts,
    collect: (context) => collectWranglerTomlDiagnostics(context),
  },
  {
    id: "amplify-yml-commands",
    gate: gates.javascriptPackageScripts,
    collect: (context) => collectAmplifyYmlDiagnostics(context),
  },
] satisfies readonly RepositoryDiagnosticCollector[];
