# detected-large-barrel-file

This repository-wide finding uses the [native source audit](../source-import-audit.md), without invoking a linter.

## What it flags

JavaScript or TypeScript files whose wildcard re-exports reach **more than 100 distinct module references**. Both `export *` and `export * as name` start traversal; type-only references also affect type graphs. The graph follows static imports/re-exports in unambiguously resolved repo-local relative modules, so a single wildcard can expose a large subtree. Cycles and repeated references are counted once, and the starting file is excluded.

## Why it matters for GitHub Actions

Large barrel files can inflate module graph construction cost for CI tasks such as:

- lint
- test
- typecheck
- build

That overhead is often paid repeatedly across jobs, processes, and files.

## What the scanner does

For JavaScript or TypeScript repositories with CI activity, the shared parser collects unsuppressed wildcard re-exports and reports at most one finding per oversized file. Traversal stops after reaching 101 distinct references; counts are a lower bound for this static reference graph, **not a claim about loaded runtime modules**. Static tsconfig/workspace/package maps are supported; see the [resolution scope](../source-import-audit.md#static-reference-maps). Conditional targets are followed only when all branches identify the same source; ambiguous/unknown targets remain leaves. Relative paths and aliases resolving to the same source count once. Named re-exports alone do not start a barrel finding. Literal dynamic imports are audited independently but do not inflate this static transitive graph.

`eslint-*` and `oxlint-*` directives for `oxc/no-barrel-file` (or `no-barrel-file`) suppress starting wildcard declarations, not the contents of other modules reached through the graph. Generated files and declaration entrypoints remain advisory.

The finding is skipped when the repository already appears to use one of these protections:

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
