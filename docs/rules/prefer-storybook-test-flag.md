# prefer-storybook-test-flag

Detects CI jobs that build Storybook for tests (Storybook Test Runner or Chromatic) without the `--test` flag.

## Why it matters

Storybook 7.6 introduced a test build mode. Passing `--test` to `storybook build` (or setting `SB_TESTBUILD=true`) skips work that tests do not need: docs compilation, docgen analysis, and sourcemaps. Storybook measured test builds **2-4x faster** with it, with smaller output.

The win is largest for docs-heavy Storybooks. It only applies to builds consumed by tests (Storybook Test Runner, Chromatic) — a build that is published with docs must not use `--test`.

## What it flags

A finding is emitted when **all** of the following hold:

1. The repository Storybook dependency is 7.6 or newer (the flag is available).
2. A job runs a direct Storybook build command (`build-storybook` or `storybook build`, not via an `npm`/`yarn`/`pnpm`/`bun` script wrapper).
3. The same job also runs a test consumer (`test-storybook`, `storybook test`, `@storybook/test-runner`, `chromatic`, `chromaui/action`, or `chromatic-com/storybook`).
4. At least one build invocation does not pass `--test` or have an applicable `SB_TESTBUILD=true` setting.

Build flags are evaluated per command, not per step. A flag on another build, a comment, echo, or option value does not enable test mode for an untuned build. `--` ends option parsing. Help/version invocations, heredoc scripts, dynamic arguments and opaque shell control flow are not inferred.

Environment settings are resolved workflow → job → step → inline command assignment. Literal `export`/`unset` and assignments to exported variables within a run script affect later commands in that script only. Unexported shell variables do not enable test mode in child processes. Another step/job, a step name or echoed `SB_TESTBUILD` cannot suppress a build. Unknown environment expansions are not treated as proof that test mode is absent.

Storybook checks the environment string `"true"` exactly; `1`, `yes` and `TRUE` do not enable test mode. YAML boolean `true` becomes that string in the runner environment. `--test` is a valueless CLI flag, not a `--test=false` setting. See [Storybook 8 CLI implementation](https://github.com/storybookjs/storybook/blob/v8.0.0/code/lib/cli/src/generate.ts).

Test consumers must be executable commands or the matching Chromatic actions; names, comments and argument values do not count. Known bootstrap prefixes and `pnpm exec`/`yarn exec` are recognized. Package-script bodies are not inferred. This remains a same-job heuristic, not proof that a particular build artifact is consumed by tests.

## Suggested action

Add `--test` to the Storybook build command (or set `SB_TESTBUILD=true`) when the build is only used for tests, not for publishing.

```diff
- npx build-storybook
+ npx build-storybook --test
```

## Verification

Compare `build-storybook` wall-clock time and output size with and without `--test`. Expect a larger gain when docs and autodocs are enabled.

## Compatibility notes

- `--test` requires Storybook 7.6+.
- `build.test` values in `main.ts` only apply when `--test` is passed.
- Do not use `--test` for a Storybook build that is published with documentation.
