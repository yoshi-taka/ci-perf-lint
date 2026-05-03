# prefer-jest-30-for-jest-29

Jest 29 repositories should consider Jest 30 when the visible TypeScript and JSDOM compatibility conditions are already satisfied.

## What it detects

This rule flags workflow jobs that run Jest when repository metadata shows:

- `jest` 29.x
- TypeScript 5.4 or newer
- JSDOM 26 or newer, or `jest-environment-jsdom` 30 or newer

## Why it matters

Jest 30 is a high-value performance release for test-heavy CI because Jest's own packages are bundled into fewer files, reducing module loading overhead during startup and test execution.

The recommendation is intentionally gated by compatibility evidence. Jest 30 raises the TypeScript floor to 5.4 and moves the jsdom environment to JSDOM 26 behavior.

## Suggested action

Before upgrading, run or enable Oxlint's `jest/no-alias-methods` rule. Jest 30 removes deprecated matcher aliases such as `toBeCalled` and `toThrowError`, and the Oxlint rule can autofix them to their canonical names.

Then follow the Jest 30 upgrade guide and review CLI, config, snapshot, matcher, and mock API changes.

## Verification

Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy jobs before and after moving to Jest 30.

## References

- https://jestjs.io/ja/docs/upgrading-to-jest30
- https://oxc.rs/docs/guide/usage/linter/rules/jest/no-alias-methods
