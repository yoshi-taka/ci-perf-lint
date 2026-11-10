# prefer-bun-fmt-over-prettier

Bun 1.4+ ships a built-in formatter whose output is Prettier-compatible and which reads an existing `.prettierrc` or `.oxfmtrc.json`. For repositories that already run Bun, using `bun fmt` removes the Prettier dependency and its separate process startup from local hooks and CI.

## Detection

The rule fires when all of the following hold:

- The repository package manager is Bun (`packageManager` in `package.json`, or `bun.lock` / `bun.lockb`).
- Prettier is visible in dependencies, config, or scripts.
- Oxfmt is not in use.
- `bun fmt` is not already used in `package.json` scripts or the workflow step.

A repository that already uses Oxfmt is not flagged; Oxfmt remains the recommendation for non-Bun repositories. `bun fmt` runs a `fmt` script from `package.json` when one exists, so a repository with `"fmt": "prettier ..."` must use `bun fmt --no-script` or rename that script before switching.

## Why it matters

- Bun's formatter is built in, so formatting does not need a separate package install or binary.
- `bun fmt --check` works as a CI gate, and `bun fmt --staged` replaces lint-staged for formatting.
- Existing Prettier and Oxfmt config files are read as-is, so migration can start without rewriting configuration.
- Plugin coverage can differ from Prettier. Files that need a Prettier plugin (for example Astro) may still fall back to an installed Prettier.

## Suggested action

Replace the Prettier dependency and entrypoint with `bun fmt` (or `bun fmt --check` in CI) after confirming output parity on the repository's files. If a `fmt` script exists, use `bun fmt --no-script` or rename it.

## Verification

Compare formatter step duration and diff output on the same file set before changing CI defaults. Confirm the repository runs Bun 1.4 or newer.

## Sources

- https://bun.com/docs/format
- https://bun.com/guides/format/migrate-from-prettier
