# prefer-eslint-concurrency

## Why it matters

ESLint v9.34.0 added multithread linting through the `--concurrency` CLI flag. Files are processed on several worker threads instead of a single main thread, and ESLint reports roughly 1.30x to 3.01x faster linting on large projects. The flag is **opt-in**: the default is `off`, equivalent to `--concurrency=1`, so existing configurations stay single-threaded until they ask for more.

`--concurrency` accepts a positive integer (for example `4`), `auto`, or `off`. For sufficiently large projects, `auto` picks about half of the reported CPU cores. The gains are largest when linting many files on a multi-core machine with fast I/O; if configuration or plugins are slow to initialize, too many threads can slow things down, and virtualized CI runners may see smaller gains.

Upgrading alone is not enough. ESLint v9 as a whole is roughly on par with v8 for general runs, so the actionable performance change is the combination of ESLint 9.34 or later **and** passing `--concurrency`.

## What it flags

- Repository configuration that pins `eslint` in the 9.x line below the release that added multithread linting (9.0 to 9.33), reported as a `warning` on `package.json`. ESLint 8 and earlier are ignored because they use the legacy eslintrc config format, so upgrading is a migration rather than a dependency bump.
- `package.json` scripts that invoke ESLint without `--concurrency` on ESLint 9.34 or later, reported as a `suggestion`.
- CI steps that invoke ESLint directly (for example `npx eslint .` or `eslint --max-warnings=0`) without `--concurrency` on ESLint 9.34 or later, reported as a `suggestion`.

Direct invocations are detected across GitHub Actions, Buildkite, CircleCI, and GitLab CI. Steps that only call an indirect script such as `npm run lint` are not flagged by the workflow rule; the script itself is covered by the repository diagnostic.

Version evidence prefers the root dependency in the lockfile. An unresolved `^9.26.0` can allow ESLint 9.34+ and does not prove that an upgrade is necessary. When support for concurrency is unknown, the rule stays silent instead of recommending an unsupported flag.

## Suggested action

- Move the `eslint` dependency to the latest 9.x release (at least 9.34). Projects already on ESLint 9 use flat config, so this is a patch/minor bump with no config-format migration.
- Add `--concurrency=auto` to ESLint invocations in CI steps and package scripts, or choose a fixed thread count that matches the runner.

## Verification

Compare ESLint wall-clock time before and after adding `--concurrency`, and re-measure on the actual CI runner. Try `auto` against a fixed thread count such as `2`, `3`, or `4`, and keep `--concurrency=off` as a baseline, because initialization-heavy configs and limited or virtualized cores can reduce the gain.

## Sources

- https://eslint.org/blog/2025/08/multithread-linting/
- https://eslint.org/blog/2025/08/eslint-v9.34.0-released/
- https://eslint.org/docs/latest/use/command-line-interface
