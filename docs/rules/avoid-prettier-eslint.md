# avoid-prettier-eslint

## What it flags

Flags repositories whose visible dependencies or config still indicate `prettier-eslint`, or workflows that call `prettier-eslint` directly.

Plain `prettier` usage alone should not trigger this rule.

## Why it matters

`prettier-eslint` chains formatter and linter fix behavior together. In most current setups that is slower and harder to reason about than running Prettier and ESLint separately.

## Current heuristic

The rule looks for visible repo-level evidence of `prettier-eslint`, or explicit workflow text mentioning `prettier-eslint`.

## When to ignore it

Ignore this finding when:

- the dependency is present but no longer used
- the repo intentionally keeps the wrapper during a temporary migration window

## Suggested verification

- Compare runtime before and after splitting the wrapper into separate commands
- Confirm the replacement commands still cover the same files and fix modes

## Sources

- https://prettier.io/docs/next/integrating-with-linters.html
- https://zenn.dev/to4_yanagi/articles/98a0246cf46400
