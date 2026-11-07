# consider-eslint-warning-rules-off-in-ci

Exploratory-only suggestion to consider skipping local-only warning rules in ESLint CI runs. No automatic fix.

## What it detects

- ESLint version is known (root dependency, using the lockfile when available).
- GitHub Actions/Depot runs ESLint from the repository root, directly or through root package scripts (up to eight nested calls).
- A root config explicitly enables warning rules (`"warn"`, `1`, or options arrays starting with either).
- The command has no warning threshold, fix mode, explicit report output, or custom config/rule flags. On ESLint 9+, an existing `--quiet` also excludes the command. Before v9, `--quiet` does **not** exclude it.

For ESLint 9+, static flat configs supported: `export default [...]`, `module.exports = [...]`, `defineConfig(...)` imported from `eslint/config` (including an alias), config-helper calls such as `tseslint.config(...)`, and same-file const arrays. Literal `rules` are merged in order across the exported config. Non-rule properties such as `files`, `languageOptions`, `plugins`, `ignores` and `name` do not hide literal rules; warnings in a scoped `files` object are tracked separately so a scoped `off` does not erase a global warning. For ESLint 8 and earlier, supported legacy configs are strict JSON `.eslintrc` / `.eslintrc.json`, `package.json#eslintConfig`, or literal JS/CJS exports containing `root` and `rules`. Extended/overridden legacy configs, YAML and older flat-config opt-ins are conservatively skipped. Multiple competing config sources are skipped.

JS/TS config is parsed, never executed. Imported presets and other non-literal elements are ignored rather than evaluated; spreads and `extends` conservatively discard earlier literal rules because they may override them. Dynamic commands, directory changes, forwarded script arguments and `ESLINT_USE_FLAT_CONFIG` assignments are skipped. Other CI platforms are not inspected.

## Defaults and version differences

- **`--quiet` is opt-in, not the default**, including on current ESLint releases.
- ESLint 8 and earlier: quiet hides warnings but still executes warning rules. **This remains a finding even when quiet is already supplied.** Suggest a CI-specific config with local-only warning rules disabled, not adding quiet.
- ESLint 9 and later: quiet skips warning-rule execution.
- **Exception:** supplying `--max-warnings` also makes warning rules execute even with quiet. All explicit warning thresholds (including `-1`) are conservatively excluded.
- Default file ignores (`**/node_modules/`, `.git/`) concern file selection, not warning severity. Do not confuse these with skipping warn rules. No recommendation to add redundant default ignores is made.

## Suggested action

Confirm warning output is only needed locally. Before ESLint 9, turn those warning rules off in a CI-specific config while preserving local warnings and CI error rules; quiet alone does not save analysis work. For ESLint 9+, consider adding `--quiet` to the CI command. No forced major upgrade is recommended.

Keep warnings needed for CI logs, reports, warning-based gates or fixes. Rules may have side effects used by error rules (for example `sourceCode.markVariableAsUsed()`); review these before skipping them. Do not assume changing `warn` to `error` improves performance.

## Measurement

Compare ESLint wall-clock time with identical runner resources and inputs. Verify required errors and reports are unchanged. No speedup is guaranteed, especially with few/cheap warning rules or a warm cache.

## References

- [ESLint v9: quiet no longer runs warn rules](https://eslint.org/docs/latest/use/migrate-to-9.0.0#quiet-warn)
- [CLI warning handling](https://eslint.org/docs/latest/use/command-line-interface#handle-warnings)
- [Default ignored files](https://eslint.org/docs/latest/use/configure/ignore)
