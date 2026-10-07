# Findings

## missing-paths-filter

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:3:5`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-paths-filter`
- Message: This workflow looks heavy, but push/pull_request do not narrow execution with paths or paths-ignore.
- Why it matters: Docs-only and unrelated changes are more likely to trigger the same expensive workflow.
- Suggested action: Add paths or paths-ignore to focus runs on code changes that actually need this workflow. If branch protection requires this workflow check, prefer keeping the workflow runnable and gating only the heavy jobs inside it.
- Measurement hint: Open a docs-only PR and confirm either the workflow no longer runs unnecessarily or the heavy jobs skip without leaving required checks pending.

## missing-path-ignore-for-non-code

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:3:5`
- Severity: `suggestion`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-path-ignore-for-non-code`
- Message: No docs or markdown-oriented paths-ignore rule was found for push/pull_request.
- Why it matters: Small documentation-only changes can still trigger expensive CI.
- Suggested action: Consider paths-ignore entries for docs, markdown, and other clearly non-code files. If branch protection requires this workflow check, prefer keeping the workflow runnable and skipping only the heavy jobs.
- Measurement hint: Create a docs-only change and confirm either the heavy workflow is skipped or the expensive jobs are skipped without leaving required checks pending.

## elixir-otp-version-performance

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:16:15`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/elixir-otp-version-performance`
- Message: Elixir 1.14 may increase compile and boot times. (detected Elixir 1.14 in job "ci").
- Why it matters: Elixir version impacts compilation and boot times in CI.
- Suggested action: Upgrade to Elixir 1.15 for faster compile and boot times in CI.
- Measurement hint: Benchmark compile times on the recommended Elixir version.

## elixir-otp-version-performance

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:16:15`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/elixir-otp-version-performance`
- Message: OTP 25 may impact CI test/runtime performance. (detected OTP 25 in job "ci").
- Why it matters: OTP 25 has known performance regressions in CI test and runtime execution.
- Suggested action: Upgrade to OTP 26 for faster test and runtime performance in CI.
- Measurement hint: Benchmark test suite runtime on OTP 26 vs 25.

## missing-make-j-flag

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:21:14`
- Severity: `warning`
- Confidence: `high`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-make-j-flag`
- Message: Job "ci" runs make/gmake without parallelization in steps #3, #4, #5.
- Why it matters: Make defaults to serial execution. 3 commands in the same job each run serially, multiplying the wasted wall time.
- Suggested action: Add -j$(nproc) to make/gmake or set MAKEFLAGS=-j$(nproc) in workflow/job/step env.
- Measurement hint: Compare build step duration before and after adding parallel flags.

## missing-timeout-minutes

- Workflow: `.github/workflows/elixir-ci.yml`
- Location: `.github/workflows/elixir-ci.yml:10:3`
- Severity: `suggestion`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-minutes`
- Message: Job "ci" does not define job-level timeout-minutes.
- Why it matters: Without a job-level timeout, a hung or degraded job falls back to the platform default timeout and can keep consuming runner capacity much longer than intended.
- Suggested action: Set a job-level timeout-minutes that matches the expected duration and failure budget for this job.
- Measurement hint: Force or simulate a hung run and confirm the job is terminated at the configured timeout.
