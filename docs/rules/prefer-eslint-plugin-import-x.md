# prefer-eslint-plugin-import-x

## What it flags

Flags repositories whose visible ESLint setup appears to use `eslint-plugin-import` without visible `eslint-plugin-import-x` usage.

The finding is repository-wide: the evidence comes from repository ESLint config and package metadata, not from a workflow-local command.

## Why it matters

`eslint-plugin-import-x` is intended as a faster modern replacement path for `eslint-plugin-import`.

When a repository still depends on `eslint-plugin-import`, import-related linting can carry more runtime and dependency overhead than necessary, especially in CI where the same lint path runs repeatedly.

## Current heuristic

The rule looks for repository-root evidence in files such as:

- `package.json`
- `eslint.config.*`
- `.eslintrc*`

It fires when:

- direct repository-root evidence of `eslint-plugin-import` is visible, such as the package dependency or explicit plugin wiring in config text
- no visible `eslint-plugin-import-x` or `import-x/...` usage is found

Shared presets that may hide the actual plugin choice are intentionally not enough on their own.

## When to ignore it

Ignore this finding when:

- the repo already evaluated `eslint-plugin-import-x` and hit compatibility issues
- custom resolver behavior or plugin coupling makes the migration risky right now
- import linting is not on a meaningful CI hot path for this repository

## Suggested verification

- Compare ESLint duration before and after the plugin swap
- Confirm resolver behavior stays correct on the repo's module layout
- Check that the required import rules still exist with acceptable semantics

## Sources

- https://github.com/un-ts/eslint-plugin-import-x
- https://e18e.dev/docs/replacements/eslint-plugin-import
