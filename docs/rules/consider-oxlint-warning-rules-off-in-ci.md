# consider-oxlint-warning-rules-off-in-ci

Exploratory-only suggestion to review local-only Oxlint warning rules in CI. No automatic fix.

## What it detects

- GitHub Actions (including Depot syntax) runs Oxlint from the repository root, directly or through root package scripts (up to eight nested calls).
- Root `.oxlintrc.json` explicitly enables at least one rule with `"warn"`, `1`, or an options array starting with either severity.
- The invocation has no warning failure threshold, fix mode, report format, or custom rule/config flags.

Calls using `--deny-warnings`, `--max-warnings`, `--quiet`, `--silent`, or `--fix` are excluded. Dynamic commands, directory changes, script arguments, extended configs, overrides, config options, JSONC and executable configs are conservatively skipped. Implicit default warnings, categories, workspace scripts and other CI platforms are not inspected.

## Why it matters

Warning-level rules still execute analysis. If their output is only useful locally, turning them off in a CI-specific config may reduce work. `--deny-warnings` changes failure policy, not analysis cost; changing `warn` to `error` is not a speed optimization.

## Suggested action

First confirm warnings are not consumed through logs, reports, quality gates or automatic fixes. Only then disable local-only rules in a CI-specific config, preserving error rules and local warnings. Do not apply this advice to embedded scanners whose warnings are the diagnostic data itself.

Warnings can be useful without failing CI, so this is a review suggestion, not a correctness finding. There is no guaranteed speedup. `--quiet` is not assumed to skip analysis; this rule does not recommend it as an optimization.

## Measurement

Compare Oxlint wall-clock time before/after on identical inputs and CI runner resources. Verify required errors and reports still work.

## References

- [Oxlint CLI: warning handling](https://oxc.rs/docs/guide/usage/linter/cli.html#handle-warnings)
