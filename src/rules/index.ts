import type { AnyRuleModule } from "../rule-engine.ts";
import type { RuleMeta } from "../types.ts";
import { validateImpliedChecks } from "./validate-implied-checks.ts";
import { repositoryDiagnosticCollectors } from "../repository-diagnostics/index.ts";
import { avoidBroadUploadArtifactRule } from "./avoid-broad-upload-artifact.ts";
import { avoidBrewUpdateOnHostedMacosRule } from "./avoid-brew-update-on-hosted-macos.ts";
import { avoidCDriveOnWindowsRunnerRule } from "./avoid-c-drive-on-windows-runner.ts";
import { avoidDockerImageViaUsesRule } from "./avoid-docker-image-via-uses.ts";
import { avoidEslintPluginPrettierRule } from "./avoid-eslint-plugin-prettier.ts";
import { avoidPrettierEslintRule } from "./avoid-prettier-eslint.ts";
import { repeatedBootstrapSetupRule } from "./repeated-bootstrap-setup.ts";
import { avoidXcodeInstallOnHostedMacosRule } from "./avoid-xcode-install-on-hosted-macos.ts";
import { cacheTerraformProvidersRule } from "./cache-terraform-providers.ts";
import { cargoBuildBeforeTestRule } from "./cargo-build-before-test.ts";
import { circleciCheckoutUsesFullCloneRule } from "./circleci-checkout-uses-full-clone.ts";
import { collapseMultipleGoBuildsInJobRule } from "./collapse-multiple-go-builds-in-job.ts";
import { considerCachingOsPackagesOrUsingACustomImageRule } from "./consider-caching-os-packages-or-using-a-custom-image.ts";
import { considerFilterBlobNoneForReleaseMetadataRule } from "./consider-filter-blob-none-for-release-metadata.ts";
import { considerSlimOverAlpineForCiRule } from "./consider-slim-over-alpine-for-ci.ts";
import { dockerBuildCacheDisabledInCiRule } from "./docker-build-cache-disabled-in-ci.ts";
import { dockerBuildLoadTrueUnnecessaryRule } from "./docker-build-load-true-unnecessary.ts";
import { dockerBuildWithoutLayerCacheRule } from "./docker-build-without-layer-cache.ts";
import { dockerBakeFileUnusedInCiRule } from "./docker-bake-file-unused-in-ci.ts";
import { duplicateCheckoutInSameWorkflowRule } from "./duplicate-checkout-in-same-workflow.ts";
import { duplicateInstallOrLintRule } from "./duplicate-install-or-lint.ts";
import { deepCheckoutExcessiveDepthRule } from "./deep-checkout-excessive-depth.ts";
import { deepCheckoutWithoutNeedRule } from "./deep-checkout-without-need.ts";
import { elixirOtpVersionPerformanceRule } from "./elixir-otp-version-performance.ts";
import { hatchWithoutUvInstallerRule } from "./hatch-without-uv-installer.ts";
import {
  goBuildBeforeRaceTestRule,
  goTestBroadPackageSerialPOneRule,
  goTestRepeatsVetAfterGoVetRule,
} from "./go-test-efficiency.ts";
import { missingConcurrencyRule } from "./missing-concurrency.ts";
import { missingDependencyCacheRule } from "./missing-dependency-cache.ts";
import { missingAngularCliCacheRule } from "./missing-angular-cli-cache.ts";
import { noxWithoutUvBackendRule } from "./nox-without-uv-backend.ts";
import { npmCiOverNpmInstallRule } from "./npm-ci-over-npm-install.ts";
import { pdmWithoutUseUvRule } from "./pdm-without-use-uv.ts";
import { missingGradleBuildCacheRule } from "./missing-gradle-build-cache.ts";
import { missingMakeJFlagRule } from "./missing-make-j-flag.ts";
import { missingNextBuildCacheRule } from "./missing-next-build-cache.ts";
import { missingPathIgnoreForNonCodeRule } from "./missing-path-ignore-for-non-code.ts";
import { missingPathsFilterRule } from "./missing-paths-filter.ts";
import { missingReleaseDownstreamSuccessGuardRule } from "./missing-release-downstream-success-guard.ts";
import { missingTimeoutInMinutesBuildkiteRule } from "./missing-timeout-in-minutes-buildkite.ts";
import { missingTimeoutInMinutesGitlabCiRule } from "./missing-timeout-in-minutes-gitlab-ci.ts";
import { missingTimeoutMinutesRule } from "./missing-timeout-minutes.ts";
import { missingTurboCacheRule } from "./missing-turbo-cache.ts";
import { matrixTestJobWithoutTestShardingRule } from "./matrix-test-job-without-test-sharding.ts";
import { npmAuditInCiRule } from "./npm-audit-in-ci.ts";
import { missingTestWorkerTuningForStandardRunnerRule } from "./missing-test-worker-tuning-for-standard-runner.ts";
import { nativeDependencyMayFallBackToSourceBuildRule } from "./native-dependency-may-fall-back-to-source-build.ts";
import { outdatedDatadogLambdaExtensionRule } from "./outdated-datadog-lambda-extension.ts";
import { outdatedSetupActionWithoutCacheRule } from "./outdated-setup-action-without-cache.ts";
import { preferUvPipOverPipRule } from "./prefer-uv-pip-over-pip.ts";
import { preferBuildxBuildOverDockerBuildRule } from "./prefer-buildx-build-over-docker-build.ts";
import { dbIoReduceRule } from "./db-io-reduce.ts";
import { preferDirectUploadForCompressedArtifactsRule } from "./prefer-direct-upload-for-compressed-artifacts.ts";
import { preferDornyPathsFilterForScopedJobsRule } from "./prefer-dorny-paths-filter-for-scoped-jobs.ts";
import { preferLefthookForComplexGitHooksRule } from "./prefer-lefthook-for-complex-git-hooks.ts";
import { preferJest30ForJest29Rule } from "./prefer-jest-30-for-jest-29.ts";
import { preferRuffFormatOverBlackRule } from "./prefer-ruff-format-over-black.ts";
import { preferOxlintOverEslintRule } from "./prefer-oxlint-over-eslint.ts";
import { preferOxfmtOverPrettierRule } from "./prefer-oxfmt-over-prettier.ts";
import {
  preferNextjs12MinorPerformanceMilestoneRule,
  preferNextjs13MinorPerformanceMilestoneRule,
  preferNextjs14MinorPerformanceMilestoneRule,
} from "./prefer-nextjs-minor-performance-milestone.ts";
import {
  preferStorybook6MinorPerformanceMilestoneRule,
  preferStorybook7MinorPerformanceMilestoneRule,
} from "./prefer-storybook-minor-performance-milestone.ts";
import { preferTailwindV4UpgradeToolRule } from "./prefer-tailwind-v4-upgrade-tool.ts";
import { preferNativeArmRunnerOverQemuRule } from "./prefer-native-arm-runner-over-qemu.ts";
import { preferFrozenLockfileRule } from "./prefer-frozen-lockfile.ts";
import { preferNodeRunOverNpmRunRule } from "./prefer-node-run-over-npm-run.ts";
import { preferNextestForHeavyRustTestsRule } from "./prefer-nextest-for-heavy-rust-tests.ts";
import { preferBuildxBakeForMultipleImagesRule } from "./prefer-buildx-bake-for-multiple-images.ts";
import { preferSparseCheckoutForScopedWorkflowRule } from "./prefer-sparse-checkout-for-scoped-workflow.ts";
import { preferStandardArmRunnerForApiCliRule } from "./prefer-standard-arm-runner-for-api-cli.ts";
import { preferStandardArmRunnerForPortableToolingRule } from "./prefer-standard-arm-runner-for-portable-tooling.ts";
import { preferSetupBunForLightweightNodeToolingRule } from "./prefer-setup-bun-for-lightweight-node-tooling.ts";
import { preferSetupUvForLightweightPythonToolingRule } from "./prefer-setup-uv-for-lightweight-python-tooling.ts";
import { preferZstdCompressionForPushedDockerImagesRule } from "./prefer-zstd-compression-for-pushed-docker-images.ts";
import { railsDbSchemaLoadOverMigrateRule } from "./rails-db-schema-load-over-migrate.ts";
import { preferRailsPerformanceMilestoneRule } from "./prefer-rails-performance-milestone.ts";
import { preferRuby33YjitRule } from "./prefer-ruby-33-yjit.ts";
import { preferRuffImportSortingOverIsortRule } from "./prefer-ruff-import-sorting-over-isort.ts";
import { rubySetupRubyMissingBundlerCacheRule } from "./ruby-setup-ruby-missing-bundler-cache.ts";
import { redundantNpxOrBootstrapRule } from "./redundant-npx-or-bootstrap.ts";
import { redundantInstallForPreinstalledCliRule } from "./redundant-install-for-preinstalled-cli.ts";
import { redundantManualCacheWithSetupActionRule } from "./redundant-manual-cache-with-setup-action.ts";
import { repeatedBuildInSameWorkflowRule } from "./repeated-build-in-same-workflow.ts";
import { repeatedInstallInSameJobRule } from "./repeated-install-in-same-job.ts";
import { repeatedLintInSameWorkflowRule } from "./repeated-lint-in-same-workflow.ts";
import { scheduledHeavyWorkflowWithoutThrottlingRule } from "./scheduled-heavy-workflow-without-throttling.ts";
import { ungatedHeavyJobRule } from "./ungated-heavy-job.ts";
import { unnecessaryAppInstallForLintJobRule } from "./unnecessary-app-install-for-lint-job.ts";
import { unnecessaryNpmGlobalUpgradeBeforeNpmInstallRule } from "./unnecessary-npm-global-upgrade-before-npm-install.ts";
import { unnecessaryCheckoutWhenOnlyUsingArtifactsRule } from "./unnecessary-checkout-when-only-using-artifacts.ts";
import { toxWithoutToxUvRule } from "./tox-without-tox-uv.ts";
import { wastefulNpmGlobalInstallRule } from "./wasteful-npm-global-install.ts";
import { wastefulPackageInstallInContainerRule } from "./wasteful-package-install-in-container.ts";

export const allRules = [
  avoidBroadUploadArtifactRule,
  avoidBrewUpdateOnHostedMacosRule,
  avoidCDriveOnWindowsRunnerRule,
  avoidDockerImageViaUsesRule,
  avoidEslintPluginPrettierRule,
  avoidPrettierEslintRule,
  avoidXcodeInstallOnHostedMacosRule,
  cacheTerraformProvidersRule,
  cargoBuildBeforeTestRule,
  circleciCheckoutUsesFullCloneRule,
  collapseMultipleGoBuildsInJobRule,
  considerCachingOsPackagesOrUsingACustomImageRule,
  considerFilterBlobNoneForReleaseMetadataRule,
  considerSlimOverAlpineForCiRule,
  dockerBuildCacheDisabledInCiRule,
  dockerBuildLoadTrueUnnecessaryRule,
  dockerBuildWithoutLayerCacheRule,
  dockerBakeFileUnusedInCiRule,
  missingConcurrencyRule,
  missingPathsFilterRule,
  missingDependencyCacheRule,
  missingAngularCliCacheRule,
  missingGradleBuildCacheRule,
  missingMakeJFlagRule,
  missingNextBuildCacheRule,
  missingPathIgnoreForNonCodeRule,
  matrixTestJobWithoutTestShardingRule,
  missingReleaseDownstreamSuccessGuardRule,
  missingTestWorkerTuningForStandardRunnerRule,
  missingTurboCacheRule,
  nativeDependencyMayFallBackToSourceBuildRule,
  npmAuditInCiRule,
  outdatedDatadogLambdaExtensionRule,
  outdatedSetupActionWithoutCacheRule,
  noxWithoutUvBackendRule,
  npmCiOverNpmInstallRule,
  pdmWithoutUseUvRule,
  ungatedHeavyJobRule,
  unnecessaryAppInstallForLintJobRule,
  unnecessaryNpmGlobalUpgradeBeforeNpmInstallRule,
  unnecessaryCheckoutWhenOnlyUsingArtifactsRule,
  deepCheckoutExcessiveDepthRule,
  deepCheckoutWithoutNeedRule,
  missingTimeoutInMinutesBuildkiteRule,
  missingTimeoutInMinutesGitlabCiRule,
  missingTimeoutMinutesRule,
  redundantNpxOrBootstrapRule,
  redundantInstallForPreinstalledCliRule,
  redundantManualCacheWithSetupActionRule,
  preferLefthookForComplexGitHooksRule,
  preferDornyPathsFilterForScopedJobsRule,
  preferJest30ForJest29Rule,
  preferBuildxBuildOverDockerBuildRule,
  dbIoReduceRule,
  preferDirectUploadForCompressedArtifactsRule,
  preferOxlintOverEslintRule,
  preferOxfmtOverPrettierRule,
  preferNextjs12MinorPerformanceMilestoneRule,
  preferNextjs13MinorPerformanceMilestoneRule,
  preferNextjs14MinorPerformanceMilestoneRule,
  preferRailsPerformanceMilestoneRule,
  preferRuby33YjitRule,
  preferStorybook6MinorPerformanceMilestoneRule,
  preferStorybook7MinorPerformanceMilestoneRule,
  preferTailwindV4UpgradeToolRule,
  preferNativeArmRunnerOverQemuRule,
  preferFrozenLockfileRule,
  preferNodeRunOverNpmRunRule,
  preferNextestForHeavyRustTestsRule,
  preferBuildxBakeForMultipleImagesRule,
  preferSparseCheckoutForScopedWorkflowRule,
  preferStandardArmRunnerForApiCliRule,
  preferStandardArmRunnerForPortableToolingRule,
  preferSetupBunForLightweightNodeToolingRule,
  preferSetupUvForLightweightPythonToolingRule,
  preferUvPipOverPipRule,
  preferZstdCompressionForPushedDockerImagesRule,
  railsDbSchemaLoadOverMigrateRule,
  rubySetupRubyMissingBundlerCacheRule,
  preferRuffFormatOverBlackRule,
  preferRuffImportSortingOverIsortRule,
  repeatedInstallInSameJobRule,
  repeatedLintInSameWorkflowRule,
  repeatedBootstrapSetupRule,
  repeatedBuildInSameWorkflowRule,
  scheduledHeavyWorkflowWithoutThrottlingRule,
  duplicateCheckoutInSameWorkflowRule,
  duplicateInstallOrLintRule,
  elixirOtpVersionPerformanceRule,
  goBuildBeforeRaceTestRule,
  hatchWithoutUvInstallerRule,
  toxWithoutToxUvRule,
  wastefulNpmGlobalInstallRule,
  wastefulPackageInstallInContainerRule,
  goTestBroadPackageSerialPOneRule,
  goTestRepeatsVetAfterGoVetRule,
] satisfies readonly AnyRuleModule[];

const _repoIds = repositoryDiagnosticCollectors.map((c) => c.id);
const _validation = validateImpliedChecks(allRules, _repoIds);
for (const { sourceId, targetId } of _validation.missingTargets) {
  console.warn(
    `[validate-implied-checks] Rule "${sourceId}" references non-existent implied check "${targetId}".`,
  );
}
for (const ruleId of _validation.unregisteredRules) {
  console.warn(`[validate-implied-checks] Rule "${ruleId}" is not registered in RULE_REGISTRY.`);
}
for (const { sourceId, targetId } of _validation.unregisteredImplications) {
  console.warn(
    `[validate-implied-checks] Implication from "${sourceId}" to unregistered rule "${targetId}".`,
  );
}

export const rulesByScope = {
  "github-actions": allRules.filter(
    (rule) => ((rule.meta as RuleMeta).scope ?? "github-actions") === "github-actions",
  ),
  buildkite: [...allRules.filter((rule) => (rule.meta as RuleMeta).scope === "buildkite")],
  "gitlab-ci": [...allRules.filter((rule) => (rule.meta as RuleMeta).scope === "gitlab-ci")],
  circleci: [...allRules.filter((rule) => (rule.meta as RuleMeta).scope === "circleci")],
  all: allRules.filter((rule) => (rule.meta as RuleMeta).scope === "all"),
};
