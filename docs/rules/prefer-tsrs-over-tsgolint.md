# `prefer-tsrs-over-tsgolint`

Reported as a warning in default strict mode.

## Why it matters

`tsrs` is the Rust port of the TypeScript 7 compiler, usable as an oxlint
type-aware backend. It implements all 61 rules of tsgolint v7.0.2007 as a
drop-in replacement, and is measured up to 5x faster with around 70% less
memory than tsgolint — up to 7x when linting and type-checking share a single
pass inside oxlint. Oxlint 1.92+ prefers tsrs automatically whenever it is
installed, falling back to tsgolint.

Performance figures: oxc blog, "Faster type-aware linting with tsrs"
(2026-11-17), with teams at Cloudflare, Owner.com and OpenAI using it for
type-aware linting.

## What it flags

A `package.json` that:

- depends on `oxlint-tsgolint` (the older type-aware backend)
- does not depend on `tsrs`, and no script already invokes it
- is on the new stack: `oxlint-tsgolint` v7.x or `typescript` 7.x

Not flagged:

- `tsrs` present (oxlint already prefers it; keeping tsgolint as fallback is
  valid)
- older 0.x `oxlint-tsgolint` with TypeScript 6 — that stack needs the
  TypeScript 7 migration first, which is separate advice
- ESLint-based repositories

## Suggested action

```sh
pnpm i -D tsrs
pnpm i -D oxlint@latest   # 1.92+ prefers tsrs automatically
pnpm exec oxlint --type-aware --type-check
```

No configuration change is needed: oxlint detects the installed backend. Keep
`oxlint-tsgolint` as a fallback while tsrs stabilizes, and report any
diagnostics, fix, or suggestion differences to the tsrs repository.

## Verification

- Compare type-aware lint and type-check wall time and peak memory before
  and after the switch.
- Confirm the same diagnostics appear (61 shared rules) and investigate any
  differences before removing tsgolint.
