# `prefer-frozen-lockfile`

## Why it matters

Frozen installs keep dependency resolution aligned with the committed lockfile.
Explicit flags are unnecessary when the package manager already enables equivalent CI behavior.

## What it flags

- Bun installs without `bun ci` or an enabled `--frozen-lockfile`.
- pnpm installs without an enabled frozen flag or an applicable CI default. pnpm defaults to frozen in CI when its lockfile is present.
- Yarn Classic installs without `--frozen-lockfile`, and modern Yarn installs whose immutable behavior is disabled. Modern Yarn defaults to immutable in CI; unknown versions are not assumed to be Classic.
- Flags are recognized anywhere after `install`/`i`, including `=true`, `=false` and negated forms. Visible CI and package-manager settings are considered.

The separate `prefer-npm-ci` rule covers npm. `pnpm ci` is not the recommended pnpm command.

## Suggested action

Commit a current lockfile and use `pnpm install --frozen-lockfile`, `yarn install --immutable` (modern), `yarn install --frozen-lockfile` (Classic), or `bun ci`.
Preserve intentional dependency-update workflows.

## Verification

Compare total install duration and verify that an out-of-date lockfile fails installation.
See [pnpm defaults](https://pnpm.io/cli/install) and [Yarn defaults](https://yarnpkg.com/cli/install).
