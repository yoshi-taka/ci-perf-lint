# Findings

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
