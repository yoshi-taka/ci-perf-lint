# Findings

## missing-paths-filter

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-paths-filter`
- Message: This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.
- Why it matters: Docs-only and unrelated changes are more likely to trigger the same expensive workflow.
- Suggested action: Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.
- Measurement hint: Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.

## missing-path-ignore-for-non-code

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-path-ignore-for-non-code`
- Message: No docs or markdown-oriented paths-ignore rule was found for push/pull_request.
- Why it matters: Small documentation-only changes can still trigger expensive CI.
- Suggested action: Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.
- Measurement hint: Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.

## detected-large-barrel-file

- Location: `src/index.js:1:1`
- Severity: `warning`
- Confidence: `high`
- Scope: `repository-wide source/tooling`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/detected-large-barrel-file`
- Message: Embedded Oxlint scan flagged src/index.js as a large barrel file. Barrel file detected, 101 modules are loaded which exceeds the threshold of 100.
- Why it matters: Embedded Oxlint `oxc/no-barrel-file` detected a large `export *` barrel. Large barrel files can inflate module graph construction cost for CI lint, test, typecheck, and build steps.
- Suggested action: Replace broad `export *` barrel usage in the flagged file with direct imports or narrower explicit re-exports, then consider adding `no-barrel-file` to keep large barrels from returning.
- Measurement hint: Compare lint, test, typecheck, or build wall-clock time before and after replacing the flagged barrel with direct imports or narrower re-exports.

## missing-concurrency

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-concurrency`
- Message: The workflow has no workflow-level or job-level concurrency setting.
- Why it matters: Older runs can continue burning runner time after newer commits arrive on the same PR or branch.
- Suggested action: Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.
- Measurement hint: Push multiple commits to the same PR and confirm only the latest run continues.

## prefer-oxlint-over-eslint

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:1:1`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-oxlint-over-eslint`
- Message: Repository appears to use ESLint without visible Oxlint adoption.
- Why it matters: Oxlint is often a drop-in or front-of-line speedup for JavaScript and TypeScript lint paths in CI. The official ESLint migration guide also documents incremental adoption, config migration, JS plugin fallback, and staged Oxlint-plus-ESLint rollouts. No visible unsupported ESLint plugin dependencies were detected at the repository root.
- Suggested action: Read OXC's 'Migrate from ESLint' guide first, then consider migrating the current ESLint entrypoint with @oxlint/migrate or running Oxlint before ESLint for a staged rollout.
- Measurement hint: Compare lint wall-clock time and rule coverage on the same target files before changing CI defaults.

## prefer-oxlint-over-eslint

- Location: `package.json:6:14`
- Severity: `warning`
- Confidence: `medium`
- Scope: `repository-wide source/tooling`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-oxlint-over-eslint`
- Message: Repository appears to use ESLint without visible Oxlint adoption.
- Why it matters: Oxlint is often a drop-in or front-of-line speedup for JavaScript and TypeScript lint paths in CI. The official ESLint migration guide also documents incremental adoption, config migration, JS plugin fallback, and staged Oxlint-plus-ESLint rollouts. No visible unsupported ESLint plugin dependencies were detected at the repository root.
- Suggested action: Read OXC's 'Migrate from ESLint' guide first, then consider migrating the current ESLint entrypoint with @oxlint/migrate or running Oxlint before ESLint for a staged rollout.
- Measurement hint: Compare lint wall-clock time and rule coverage on the same target files before changing CI defaults.

## missing-dependency-cache

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:14:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: actions/setup-node@v4 is used without visible dependency caching for npm in job "lint".
- Why it matters: Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths.
- Suggested action: If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling cache.

## prefer-node-run-over-npm-run

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:18:14`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-node-run-over-npm-run`
- Message: Job "lint" runs package script "lint" through npm run.
- Why it matters: For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.
- Suggested action: Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.
- Measurement hint: Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.

## missing-timeout-minutes

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:10:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "lint" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.
