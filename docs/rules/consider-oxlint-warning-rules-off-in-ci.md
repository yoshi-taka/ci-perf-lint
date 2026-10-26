# consider-oxlint-warning-rules-off-in-ci

Exploratory-only suggestion to review local-only Oxlint warning rules in CI. No automatic fix.

## What it detects

- GitHub Actions (including Depot syntax) runs Oxlint from the repository root, directly or through root package scripts (up to eight nested calls).
- Root `.oxlintrc.json` explicitly enables at least one rule with `"warn"`, `1`, or an options array starting with either severity.
- The invocation has no warning failure threshold, fix mode, report format, or custom rule/config flags.

Calls using `--deny-warnings`, `--max-warnings`, or `--fix` are excluded. **`--quiet` and `--silent` are not excluded:** they only hide output and do not skip warning analysis. Warning gates, fixes and report/config flags remain exclusions even when combined with quiet/silent. Dynamic commands, directory changes, script arguments, extended configs, overrides, config options, JSONC and executable configs are conservatively skipped. Implicit default warnings, categories, workspace scripts and other CI platforms are not inspected.

## Why it matters

Warning-level rules still execute analysis, including with `--quiet` or `--silent`. These flags suppress diagnostic output, not rule execution. If warning output is only useful locally, turning those rules off in CI may reduce work. `--deny-warnings` changes failure policy, not analysis cost; changing `warn` to `error` is not a speed optimization.

## Suggested action

First confirm warnings are not consumed through logs, reports, quality gates or automatic fixes. Only then disable local-only rules in a CI-specific config, preserving error rules and local warnings. Do not apply this advice to embedded scanners whose warnings are the diagnostic data itself.

Either select a CI-specific JSON config with `-c`, or use conditional severity in an executable JS/TS config supported by your Oxlint version/runtime. For example:

```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  rules: {
    "no-debugger": process.env.CI === "true" || process.env.CI === "1" ? "off" : "warn",
  },
});
```

Adapt the CI check to the environment's actual values (`"false"` is a truthy string). Preserve options when changing array-form rules and do not turn error rules off. Executable config is not required if a separate JSON config fits better; this detector does not evaluate executable configs.

Warnings can be useful without failing CI, so this is a review suggestion, not a correctness finding. There is no guaranteed speedup. This rule does not recommend quiet/silent as an analysis optimization. Unlike Oxlint, ESLint 9+ can skip warn rules with quiet (unless `--max-warnings` is supplied); ESLint 8 and earlier cannot.

## Measurement

Compare Oxlint wall-clock time before/after on identical inputs and CI runner resources. Verify required errors and reports still work.

## References

- [Oxlint CLI: warning handling](https://oxc.rs/docs/guide/usage/linter/cli.html#handle-warnings)
- [Oxlint 1.88 diagnostic-output filtering](https://github.com/oxc-project/oxc/blob/oxlint_v1.88.0/crates/oxc_diagnostics/src/service.rs#L163-L171)
