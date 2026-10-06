# prefer-jest-30-for-jest-29

Jest 29 repositories should consider Jest 30, and Jest 30.x repositories below 30.5 should move to the 30.5 performance release.

## What it detects

This rule flags two cases:

- `jest` 29.x with TypeScript 5.4+ and JSDOM 26+ (or `jest-environment-jsdom` 30+), targeting **30.5.1+** directly
- `jest` 30.0–30.4, which is below the 30.5 performance release

## Why it matters

Jest 30 is a high-value performance release for test-heavy CI because Jest's own packages are bundled into fewer files, reducing module loading overhead during startup and test execution.

Jest 30.5 is the notable 30.x performance release:

- warm module resolution cost drops to roughly a third
- per-`require` overhead in `jest-runtime` is cut
- `jest-snapshot` lazy-loads babel, semver and synckit, so every test process loads about 200 fewer modules
- `jest-haste-map` caches the watchman socket path, so warm runs spawn no watchman processes

The 29 → 30 recommendation is intentionally gated by compatibility evidence. Jest 30 raises the TypeScript floor to 5.4 and moves the jsdom environment to JSDOM 26 behavior.

## Suggested action

For Jest 29, upgrade straight to at least **30.5.1**. Run or enable Oxlint's `jest/no-alias-methods` rule first: Jest 30 removes deprecated matcher aliases such as `toBeCalled` and `toThrowError`, and the Oxlint rule can autofix them to their canonical names. Then follow the Jest 30 upgrade guide and review CLI, config, snapshot, matcher, and mock API changes.

For Jest 30.x below 30.5, move to at least **30.5.1**. Do not stop at 30.5.0: it had an ESM `#imports` subpath regression fixed in 30.5.1, so native-ESM suites should verify package `imports` subpaths after upgrading.

## Verification

Compare Jest wall-clock time, startup time, worker memory, and module-load-heavy jobs before and after moving to Jest 30 or 30.5.

## References

- https://jestjs.io/ja/docs/upgrading-to-jest30
- https://oxc.rs/docs/guide/usage/linter/rules/jest/no-alias-methods
