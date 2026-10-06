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
4. The build command does not pass `--test`, and the workflow does not set `SB_TESTBUILD=true`.

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
