# prefer-oxlint-type-check-over-tsc

## Why it matters

Oxlint's type-aware mode runs the TypeScript type checker (tsgolint) inside the same TypeScript program it uses for linting. That means one pass can both lint and report type errors, replacing a separate `tsc --noEmit` step and avoiding the duplicate program setup and analysis.

- `oxlint --type-aware` enables rules that need type information.
- `oxlint --type-check` additionally reports TypeScript compiler diagnostics, so the Oxc docs describe it as able to replace a separate `tsc --noEmit` step in CI.
- tsgolint v7 (stable, 2026-07) is built on the TypeScript 7 native compiler (`typescript-go`), covers 59 of 61 typescript-eslint type-aware rules, and benchmarks 12-18x faster than ESLint plus typescript-eslint on large TypeScript codebases. TypeScript 7.0+ is required.

## What it flags

The rule reports a separate tsc type-check path when the repository already uses oxlint:

- GitHub Actions steps whose shell command runs `tsc --noEmit`, `tsc -b`, or `tsc --build`.
- `package.json` scripts (for example `typecheck`, `type-check`, `check:types`) that run the same commands.

It only fires when oxlint is a repository dependency. Declaration/build emit that is separate from type checking (`tsc` without `--noEmit`/`--build`) is not flagged, and `vue-tsc` / `svelte-check` are intentionally out of scope because their coverage over `.vue` / `.svelte` files is not equivalent.

## Prerequisites

Folding type checking into oxlint requires:

- A current oxlint. The `typeAware` / `typeCheck` config options were added in oxlint 1.51.0; use the latest release.
- `oxlint-tsgolint@7` installed as a dev dependency (the type-aware engine).
- TypeScript 7.0+. Type-aware linting is powered by `typescript-go`, and tsgolint is built on TypeScript 7. Some legacy `tsconfig` options are unsupported (for example `baseUrl`), and options deprecated in TypeScript 6.0 / removed in 7.0 must be migrated first (see `ts5to6`).

The finding message states which prerequisite is still missing for the repository.

## Suggested action

Confirm oxlint and `oxlint-tsgolint` are current, then replace the separate tsc type-check with `oxlint --type-aware --type-check` on the lint step and remove the redundant tsc invocation. Keep any separate declaration/build emit.

## Verification

Compare CI type-check wall-clock time and reported type errors before and after folding `tsc --noEmit` into `oxlint --type-aware --type-check`.

## Sources

- https://oxc.rs/docs/guide/usage/linter/type-aware
- https://oxc.rs/blog/2026-07-22-type-aware-linting-stable
