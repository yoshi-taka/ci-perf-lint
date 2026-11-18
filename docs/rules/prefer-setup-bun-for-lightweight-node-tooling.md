# prefer-setup-bun-for-lightweight-node-tooling

Lightweight/heavy evidence comes from invoked executables and package-manager task names, not step labels, printed commands or argument filenames. Printed Nx commands do not supply an exemption. Actual application/native work, dynamic executable selection and unexpanded local scripts prevent the lightweight-only recommendation. Task names remain heuristic signals; script bodies are not compiled or executed.

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

## Bun dependency caching

`oven-sh/setup-bun` does **not** cache bun's dependencies. Its cache input
covers only the downloaded Bun executable; bun's install cache lives in
`~/.bun/install/cache` and is rebuilt on every fresh runner. When `bun
install` cost matters, pair the switch with an explicit cache step:

```yaml
- uses: oven-sh/setup-bun@v2
- uses: actions/cache@v5
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
    restore-keys: |
      bun-${{ runner.os }}-
- run: bun install --frozen-lockfile
```

The `missing-dependency-cache` rule flags `setup-bun` jobs that lack this
cache; keep it only when total job duration actually improves, since cache
restore and save overhead can outweigh a fast install.

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

- Compare total job duration before and after switching to `setup-bun`, including dependency cache restore and save time
- Confirm the same tools and file targets still run successfully

## Sources

- https://bun.sh/docs/installation
- https://bun.sh/docs/cli/bunx
- https://github.com/oven-sh/setup-bun
