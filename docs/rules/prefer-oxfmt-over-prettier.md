# prefer-oxfmt-over-prettier

## What it flags

Flags repositories that appear to use Prettier without visible Oxfmt adoption.

The finding is repository-wide: the evidence comes from repository formatting config and package metadata, not from a workflow-local command.

## Why it matters

Oxfmt is positioned by OXC as a high-performance, Prettier-compatible formatter for the JavaScript ecosystem, so a direct CI formatting path is often a good migration candidate.

The practical reason this rule recommends Oxfmt is not only raw speed. For simple Prettier paths, Oxfmt is intended to fit existing Prettier-style `format` / `format:check` workflows with minimal script, CI, and hook changes. That drop-in-style migration path is especially valuable when the repository has a straightforward Prettier setup and no required Prettier plugins.

The main reference for acting on this finding should be OXC's official guide:

- `https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier.html`

That guide is more useful than a generic "swap prettier for oxfmt" suggestion because it covers:

- `oxfmt --migrate=prettier`
- config differences such as default `printWidth`
- script, CI, and hook updates
- Prettier plugin limitations and unsupported options

This rule is intentionally split by severity:

- `warning`: no visible Prettier plugins were detected at the repository root
- `suggestion`: visible Prettier plugins were detected, so compatibility should be reviewed before replacing Prettier

## Current heuristic

The rule looks for:

- repository-root Prettier usage hints from files such as `.prettierrc*`, `prettier.config.*`, or `package.json`
- no visible repository-root Oxfmt usage

## When to ignore it

Ignore this finding when:

- the repo depends on Prettier plugins that still matter for the current formatting path
- the workflow intentionally keeps Prettier as the authoritative formatter and migration has already been evaluated
- the repository uses Prettier only indirectly and the current formatter entrypoint has already been reviewed

## Suggested verification

- Read OXC's `Migrate from Prettier` guide before changing CI defaults
- Compare formatting step duration before and after introducing `oxfmt`
- Check whether formatted output stays acceptable on the same file set
- If Prettier plugins are present, confirm whether Oxfmt already covers the needed behavior natively

## Sources

- https://oxc.rs/docs/guide/usage/formatter
- https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier
- https://oxc.rs/docs/guide/usage/formatter/config-file-reference
