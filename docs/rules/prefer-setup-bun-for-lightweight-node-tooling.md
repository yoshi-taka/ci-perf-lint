# prefer-setup-bun-for-lightweight-node-tooling

## What it flags

Flags jobs that:

- use `actions/setup-node`
- do not already use `oven-sh/setup-bun`
- do not already use `pnpm/action-setup`
- look like lightweight Node-based tooling jobs
- are not visibly using `bun` or `pnpm` already

This rule is intended for repository tooling such as lint, formatting, markdown/docs checks, spell checks, and similar non-product tasks.

## Why it matters

For lightweight tooling-only jobs, Bun can often reduce setup and command startup overhead compared with a plain `setup-node` plus `npm` or `yarn` path.

## Current heuristic

The rule looks for:

- visible lightweight tooling commands such as `eslint`, `prettier`, `oxlint`, `oxfmt`, `biome`, `markdownlint`, `cspell`, `actionlint`, `shellcheck`, or `yamllint`
- no visible product-facing or heavier Node work such as test, build, typecheck, bundle, or release commands

The rule intentionally skips:

- jobs already using `setup-bun`
- jobs already using `pnpm/action-setup`
- jobs visibly using `bun` or `pnpm`
- jobs that orchestrate work through `nx`

## When to ignore it

Ignore this finding when:

- the job needs `npm` or `yarn` specific behavior
- the job also does heavier work that the heuristic cannot see
- the job installs a monorepo workspace and runs that work through `nx`
- the repository standard intentionally keeps all Node-based jobs on the same runtime setup

## Suggested verification

- Compare total job duration before and after switching to `setup-bun`
- Confirm the same tools and file targets still run successfully

## Sources

- https://bun.sh/docs/installation
- https://bun.sh/docs/cli/bunx
- https://github.com/oven-sh/setup-bun
