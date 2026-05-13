# Findings

## missing-timeout-in-minutes-buildkite

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:2:12`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/missing-timeout-in-minutes-buildkite`
- Message: Step ":hammer: Tests" does not define timeout_in_minutes.
- Why it matters: Buildkite has no default timeout. Without timeout_in_minutes, a hung or degraded step can run indefinitely and consume agent capacity.
- Suggested action: Add timeout_in_minutes to the step to prevent unbounded execution.
- Measurement hint: Monitor the step's typical duration and set timeout_in_minutes to a value that allows for normal variance but catches hangs.

## prefer-node-run-over-npm-run

- Workflow: `.buildkite/pipeline.yml`
- Location: `.buildkite/pipeline.yml:11:14`
- Severity: `warning`
- Confidence: `medium`
- Rule docs: `https://ci-perf-lint.veritycost.com/rules/prefer-node-run-over-npm-run`
- Message: Step ":package: Build" runs package script "build" through npm run.
- Why it matters: For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.
- Suggested action: Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.
- Measurement hint: Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.
