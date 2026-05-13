# Findings

## missing-paths-filter

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-paths-filter`
- Message: This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.
- Why it matters: Docs-only and unrelated changes are more likely to trigger the same expensive workflow. This repository already uses trigger path filters in `.github/workflows/docs.yml`.
- Suggested action: Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.
- Measurement hint: Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.

## missing-path-ignore-for-non-code

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-path-ignore-for-non-code`
- Message: No docs or markdown-oriented paths-ignore rule was found for push/pull_request.
- Why it matters: Small documentation-only changes can still trigger expensive CI. This repository already ignores obvious non-code changes in `.github/workflows/docs.yml`.
- Suggested action: Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.
- Measurement hint: Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.

## outdated-setup-action-without-cache

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:16:15`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/outdated-setup-action-without-cache`
- Message: actions/setup-node@v2 is old and no cache configuration is visible.
- Why it matters: The performance win is not the version bump by itself; it is using a current setup action to enable the package-manager cache close to the language setup step. Without visible cache configuration, dependency downloads and installs are more likely to be paid again on each run.
- Suggested action: Upgrade to a current setup action major and enable its built-in cache for the package manager or language dependency path used by this job.
- Measurement hint: Re-run the workflow after updating setup and compare setup, cache restore, and dependency install duration.

## deep-checkout-without-need

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:15:11`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/deep-checkout-without-need`
- Message: actions/checkout uses fetch-depth: 0 in job "test", but no history-dependent command was detected.
- Why it matters: Full history checkout (fetch-depth: 0) increases clone time and network usage. In many cases a bounded depth such as 100 or 1000 is sufficient, optionally combined with `fetch-tags: true` for versioning or changelog workflows. This rule only reports when the same job does not visibly run history-dependent git operations, commit-range tooling such as commitlint, release/version/tag logic, opaque repository scripts, or write-capable repository mutation steps. This repository already keeps checkout shallow in `.github/workflows/docs.yml:docs`.
- Suggested action: Confirm whether full history is required. If not, use the default shallow checkout. If this was added for tag-based versioning or changelog generation, prefer `fetch-tags: true` with a bounded `fetch-depth` such as 100 or 1000 where possible. If recent history is required, consider a bounded depth such as 100 or 1000. If history is required but file contents are not needed eagerly, keep the history depth and consider `filter: blob:none` instead.
- Measurement hint: Compare checkout duration before and after the change, and verify any tag/version/changelog step still produces the same result.

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

## missing-dependency-cache

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:16:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: actions/setup-node@v2 is used without visible dependency caching for npm in job "test".
- Why it matters: Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths.
- Suggested action: If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling cache.

## missing-timeout-minutes

- Workflow: `.github/workflows/ci.yml`
- Location: `.github/workflows/ci.yml:10:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "test" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.
