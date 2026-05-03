# detected-large-barrel-file

This repository-wide finding comes from an embedded `oxlint` scan using `oxc/no-barrel-file`.

## What it flags

Large JavaScript or TypeScript barrel files that rely on broad `export *` re-exports and exceed Oxlint's barrel threshold.

## Why it matters for GitHub Actions

Large barrel files can inflate module graph construction cost for CI tasks such as:

- lint
- test
- typecheck
- build

That overhead is often paid repeatedly across jobs, processes, and files.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository with JS or TS CI activity, it may run an embedded `oxlint` check for `oxc/no-barrel-file`.

The embedded scan is skipped when the repository already appears to use one of these protections:

- `oxlint`
- `no-barrel-file`
- `eslint-plugin-no-barrel-files`
- `eslint-plugin-barrel-files`

## Suggested action

Replace broad `export *` barrel patterns with direct imports or narrower explicit re-exports, especially on internal code paths that affect CI lint, test, typecheck, or build steps.

Do not apply that mechanically to generated files or deliberate public declaration entrypoints such as `.d.ts` API surfaces. Those should be reviewed more carefully than ordinary internal barrels.

After cleaning up the flagged files, consider adding `no-barrel-file` as a focused guardrail so new large barrels fail during lint instead of being rediscovered later.

## Verification

Compare lint, test, typecheck, or build wall-clock time before and after removing the flagged barrel patterns.

## References

- https://github.com/Nergie/no-barrel-file
