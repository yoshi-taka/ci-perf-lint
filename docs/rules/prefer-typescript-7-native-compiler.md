# prefer-typescript-7-native-compiler

## Why it matters

TypeScript 7 is a native Go port of the compiler (Project Corsa). It keeps the type-checking logic of TypeScript 6.0 while replacing the Node.js-based `tsc` with a native binary that uses shared-memory parallelism.

Microsoft reports on production-scale codebases:

- 7x-12x faster full builds (for example VS Code 125.7s -> 10.6s)
- up to 30x faster type checking on medium-to-large projects
- roughly 3x lower memory use
- faster editor startup and first-error latency through the native language service

The speed comes from native execution and parallelism, not from changed checking rules, so moving to TypeScript 7 is mostly a compiler swap.

## What it flags

Flags a repository whose `package.json` depends on TypeScript 4.x, 5.x, or 6.x. The rule reads the TypeScript version from repository signals derived from `package.json`.

Repositories already on TypeScript 7.x, or with no detectable `typescript` dependency, are not flagged.

This rule is independent from `prefer-typescript-5-performance-milestone`, which recommends short-term 5.x milestones. A repository on TypeScript 5.x can receive both findings: one for the next 5.x step and one for the larger 7.x jump.

## Suggested action

- Confirm the codebase compiles cleanly under TypeScript 6.0 semantics first (`stableTypeOrdering` on, no `ignoreDeprecations`). The TypeScript team expects code that compiles cleanly with 6.0 to compile identically under 7.0.
- Switch the `typescript` dependency to 7.x. The compiler binary is `tsc`.
- TypeScript 7.0 does not ship a stable programmatic API (planned for 7.1). If a tool such as typescript-eslint needs the API, run TypeScript 6 and 7 side by side instead of replacing the package outright.
- In CI, tune `--checkers` and `--builders` to the runner. These are not auto-detected: `--checkers` defaults to a fixed 4 and `--builders` controls parallel project-reference builds under `--build`. Raise them on larger runners and lower them on small or memory-limited runners; use `--singleThreaded` to disable parallelization entirely. Parsing and emitting parallelize automatically, but type-checking only scales when these flags are set.

## Verification

- Compare full type-check and build wall-clock time before and after the upgrade.
- Compare peak memory during type checking.
- Check editor or language-service error latency if it matters for local development.
- Run the existing test suite and type-check in CI to confirm behavioral parity.

## What the scanner does

- Gate: JavaScript-heavy repository diagnostics.
- Reads the `typescript` dependency version from `package.json`.
- Emits one finding when the parsed major version is 4, 5, or 6.

## Sources

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/
- https://github.com/microsoft/typescript-go
