# prefer-oxlint-over-eslint

## What it flags

Flags repositories that appear to use ESLint without visible Oxlint adoption.

The finding is repository-wide: the evidence comes from repository lint config and package metadata, not from a workflow-local command.

## Why it matters

For many CI lint paths, `oxlint` can replace a direct `eslint` invocation or sit in front of it to shorten feedback time.

The main reference for acting on this finding should be OXC's official guide:

- `https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html`

That guide is more useful than a generic "swap eslint for oxlint" suggestion because it covers:

- incremental adoption instead of forced big-bang migration
- `@oxlint/migrate` for flat-config migration
- JS Plugins for unsupported ESLint plugins
- running `oxlint && eslint` during staged rollout

This rule is intentionally split by severity:

- `warning`: no visible unsupported ESLint plugin/custom-rule signals were found, or the visible plugin set maps to Oxlint built-ins
- `suggestion`: repository-level ESLint setup appears to rely on unsupported plugins or local/custom extensions that deserve migration review first

## Current heuristic

The rule looks for:

- repository-root ESLint usage hints from files such as `eslint.config.*`, `.eslintrc*`, or `package.json`
- no visible repository-root Oxlint usage

Plugin compatibility is treated conservatively.

Compatible plugin families currently include the Oxlint built-ins documented by OXC, such as:

- `typescript`
- `react`
- `react-perf`
- `nextjs`
- `import`
- `jsdoc`
- `jsx-a11y`
- `node`
- `promise`
- `jest`
- `vitest`
- `unicorn`
- `vue`

## When to ignore it

Ignore this finding when:

- the repo depends on ESLint plugins or local rules that still need ESLint semantics
- the workflow intentionally keeps `eslint` as the authoritative pass and any Oxlint migration has already been evaluated
- the repository uses ESLint only indirectly and the current lint entrypoint has already been reviewed

## Suggested verification

- Read OXC's `Migrate from ESLint` guide before changing CI defaults
- Compare lint duration before and after introducing `oxlint`
- Check whether the required rule coverage is preserved
- If doing staged migration, confirm `oxlint` can run first without changing the final ESLint gate yet

## Sources

- https://oxc.rs/docs/guide/usage/linter.html
- https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html
- https://oxc.rs/docs/guide/usage/linter/plugins
- https://oxc.rs/docs/guide/usage/linter/js-plugins
