# avoid-duplicate-prettier-check

## What it flags

Flags workflows that run the same `prettier --check <scope>` twice across steps. The check may be hidden inside a package script, for example `prettier --check . && eslint .` expanded from `npm run check`, while a separate step runs `npm run prettier-check`.

Package scripts are expanded before comparison, including script-to-script delegation. Confidence is high only when the target file scope matches exactly (for example both runs use `.`).

## Why it matters

Formatting the same scope twice repeats work without adding coverage. In CI that means extra process startup and file scanning on every run.

## When to ignore it

Ignore this finding when the two runs target different files or when one of them is intentionally a staged-only or path-limited check. The rule only compares identical scopes.

## Suggested verification

- List the expanded commands behind each workflow step
- Remove one of the identical `prettier --check` calls
- Confirm formatting is still enforced and that CI time drops
