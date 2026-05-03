# avoid-eslint-plugin-prettier

## What it flags

Flags repositories whose visible ESLint config appears to wire Prettier into ESLint.

The finding is repository-wide: the evidence comes from repository ESLint config and package metadata, not from a workflow-local command.

## Why it matters

`eslint-plugin-prettier` style integration runs Prettier through ESLint instead of keeping formatting as an independent step.

That usually makes the lint path heavier and noisier:

- ESLint has to carry formatting work in addition to lint work
- formatting differences show up as lint failures, which increases CI noise
- formatter and linter responsibilities become harder to optimize independently

Running `prettier --check` or another dedicated formatter step separately is usually easier to reason about and often faster in CI.

Typical repo evidence includes:

- `eslint-plugin-prettier`
- `plugin:prettier/recommended`
- `prettier/prettier` rule

## Current heuristic

The rule looks for visible repo-level evidence that Prettier is wired into ESLint.

## When to ignore it

Ignore this finding when:

- the repo is intentionally in the middle of a migration and the integration is temporary
- the dependency is present but no longer used by actual lint entrypoints

## Suggested verification

- Compare ESLint step duration before and after separating Prettier
- Confirm formatting still runs independently in CI or editor flows
- Check that formatting differences are still enforced through a separate formatter step such as `prettier --check`

## Sources

- https://prettier.io/docs/next/integrating-with-linters.html
- https://prettier.io/docs/install.html
