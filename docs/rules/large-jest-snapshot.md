# large-jest-snapshot

This repository-wide finding uses the [native source audit](../source-import-audit.md), without invoking a linter.

Inline snapshots in JS/TS source are checked through the shared AST. External `.snap` files retain their separate scanner. The AST scan skips `*.snapshot/` and `__snapshots__/` directories; external `.snap` checks still include them.

Supported component scripts also participate. Astro frontmatter/client scopes are separate. Vue/Svelte imports are hoisted while ordinary instance declarations stay in a child lexical scope, matching framework-generated JS. Unknown script bindings withhold snapshots with a warning. Template snapshot provenance and target preprocessors are not evaluated.

## What it flags

Jest snapshots exceeding **50 logical lines inline** or **300 lines externally**. Inline sizes use decoded static string/template contents, including leading/trailing empty lines. Interpolated templates are not statically evaluated.

## Why it matters for GitHub Actions

Large snapshots make test failures noisier, reviews slower, and snapshot updates easier to approve without checking the important behavior. They can also add avoidable parsing, transform, diff, and output work to Jest jobs.

## What the scanner does

The repository must depend on Jest or `@jest/globals` and have CI activity. The audit recognizes global `expect`, named imports/aliases and namespace `globals.expect` from `@jest/globals`, with `toMatchInlineSnapshot` and `toThrowErrorMatchingInlineSnapshot`. Property matchers, static computed matcher names, and `.not`/`.resolves`/`.rejects` chains are supported.

Parameters, local bindings, other libraries' imports, assignments and duplicate declarations invalidate that `expect` binding conservatively. Namespace property writes invalidate namespace provenance too. Lexically prior unwritten `const`/`let`/`var` aliases are followed, including namespace property destructuring and chains. Exact synchronous single-parameter wrappers returning only `expect(parameter)` are recognized; function declarations can be hoisted. Writes cannot resurrect invalid provenance. Forward variable aliases, cross-file identity, arbitrary/transformed wrappers, reflection and dynamic snapshot text are outside scope; propagation has a 32-pass bound. `eslint-*` and `oxlint-*` comments for `jest/no-large-snapshots` are respected for inline snapshots. The external scanner parses static generated assignments, including escaped backticks/names, rather than executing code or matching body delimiters with regex. Invalid `.snap` syntax emits an analysis warning. External scanning does not evaluate suppression comments or target lint configuration.

## Suggested action

Prefer smaller snapshots or direct assertions that pin the behavior under test. External snapshot files (`.snap`) have a higher threshold (300 lines) since they are only loaded when the matching test runs, but inline snapshots in source code are kept to a lower limit (50 lines) because they are parsed on every test execution.

For intentional inline snapshots, use a focused suppression comment with a reason. Lint configuration `allowedSnapshots` does not configure this standalone audit; keep that distinction when using a separate snapshot linter.

## Verification

Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially for jobs that update or diff snapshots.

## References

- https://oxc.rs/docs/guide/usage/linter/rules/jest/no-large-snapshots
