# prefer-standard-arm-runner-for-portable-tooling

Flags lightweight lint or format tooling jobs that run on standard x64 Ubuntu GitHub-hosted runners and may be good candidates for the matching standard arm64 Ubuntu runner.

## Why it matters

This is an arm64 runner recommendation, not a recommendation to replace the detected tool. The detected tool is evidence that the job is likely lightweight and architecture-portable.

Fast lint and format jobs can be short enough that runner choice and billing granularity matter. GitHub rounds partial minutes for each job up to a whole minute, so a very fast tool can still consume a full billable minute. If the job does not compile native code, run browser tests, use containers, or do other architecture-sensitive work, a standard arm64 runner can be a practical candidate for reducing cost or improving runner efficiency while preserving the same command.

Portable tools that commonly run on arm64 are useful signals for this rule. Examples include:

- `oxlint`
- `oxfmt`
- `ruff`
- `biome`
- `actionlint`
- `shellcheck`
- `yamllint`
- `markdownlint`
- `cspell`

## Current heuristic

This rule only fires when all of the following are visible:

- the job runs on `ubuntu-latest`, `ubuntu-24.04`, or `ubuntu-22.04`
- the job does not already run on an arm64-like runner
- the job is not configured with a job container
- one of the portable fast tooling commands above is visible
- no architecture-sensitive work is visible in the same job

Architecture-sensitive work includes Docker builds, native compilation, browser tests, heavy test runners, TypeScript typechecking, Electron, Tauri, and similar local CPU or platform-sensitive tasks.

## Suggested fix

Test changing only the runner label to the corresponding standard arm64 Ubuntu label, then keep the change only if the CLI install path, cache behavior, and output remain compatible.

## Measurement hint

Compare wall-clock duration, billed runner time, setup/cache time, and failure rate across several runs before and after changing only the runner label.

## Sources

- https://docs.github.com/billing/reference/actions-minute-multipliers
