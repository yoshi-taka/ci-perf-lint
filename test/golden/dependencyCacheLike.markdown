# Findings

## missing-paths-filter

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-paths-filter`
- Message: This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.
- Why it matters: Docs-only and unrelated changes are more likely to trigger the same expensive workflow.
- Suggested action: Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.
- Measurement hint: Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.

## missing-path-ignore-for-non-code

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-path-ignore-for-non-code`
- Message: No docs or markdown-oriented paths-ignore rule was found for push/pull_request.
- Why it matters: Small documentation-only changes can still trigger expensive CI.
- Suggested action: Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.
- Measurement hint: Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.

## missing-concurrency

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:4:3`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-concurrency`
- Message: The workflow has no workflow-level or job-level concurrency setting.
- Why it matters: Older runs can continue burning runner time after newer commits arrive on the same PR or branch.
- Suggested action: Add concurrency with cancel-in-progress for pull_request or branch-scoped runs.
- Measurement hint: Push multiple commits to the same PR and confirm only the latest run continues.

## duplicate-checkout-in-same-workflow

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:10:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/duplicate-checkout-in-same-workflow`
- Message: Multiple jobs (dotnet_missing, go_default_cache, java_missing, node_auto_cache, python_manual_cache, python_missing, ruby_builtin_cache) each perform checkout before dependency installation.
- Why it matters: Each GitHub Actions job gets its own runner workspace, so checkout, cache restore, and dependency setup are repeated for every job. When those jobs cover overlapping work, the workflow can pay the same setup cost multiple times without adding much signal.
- Suggested action: Confirm whether these jobs need isolated checkout/setup paths; if the work overlaps, consolidate it, split only the truly different checks, or pass reusable artifacts between jobs.
- Measurement hint: Compare total workflow duration, runner minutes, checkout time, and setup/install time after consolidating one duplicated checkout-heavy path.

## missing-dependency-cache

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:20:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: actions/setup-python@v6 is used without visible dependency caching for pip in job "python_missing".
- Why it matters: Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths. This repository already uses dependency caching in `.github/workflows/cache.yml:go_default_cache`, `.github/workflows/cache.yml:node_auto_cache`, `.github/workflows/cache.yml:python_manual_cache`. That makes the missing cache look more like one repository-local drift point than a deliberate no-cache policy. In this repository, 3 similar jobs already use dependency caching. Similar jobs already using dependency cache include `.github/workflows/cache.yml:node_auto_cache`, `.github/workflows/cache.yml:python_manual_cache`, `.github/workflows/cache.yml:ruby_builtin_cache`.
- Suggested action: If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling cache.

## missing-dependency-cache

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:34:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: actions/setup-java@v5 is used without visible dependency caching for maven in job "java_missing".
- Why it matters: Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths. This repository already uses dependency caching in `.github/workflows/cache.yml:go_default_cache`, `.github/workflows/cache.yml:node_auto_cache`, `.github/workflows/cache.yml:python_manual_cache`.
- Suggested action: If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling cache.

## missing-dependency-cache

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:44:15`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-dependency-cache`
- Message: actions/setup-dotnet@v5 is used without visible dependency caching for nuget in job "dotnet_missing".
- Why it matters: Dependency install cost may be paid on every run, but cache restore and save overhead on GitHub Actions can outweigh the benefit on some CI paths. This repository already uses dependency caching in `.github/workflows/cache.yml:go_default_cache`, `.github/workflows/cache.yml:node_auto_cache`, `.github/workflows/cache.yml:python_manual_cache`.
- Suggested action: If this install path is expensive enough to justify it, try the setup action cache or one explicit dependency cache strategy for this job and keep it only if total job time improves.
- Measurement hint: Compare total job duration, not just install duration, before and after enabling cache.

## missing-timeout-minutes

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:7:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "node_auto_cache" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.

## missing-timeout-minutes

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:16:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "python_missing" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.

## missing-timeout-minutes

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:47:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "python_manual_cache" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.

## missing-timeout-minutes

- Workflow: `.github/workflows/cache.yml`
- Location: `.github/workflows/cache.yml:58:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "ruby_builtin_cache" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.
