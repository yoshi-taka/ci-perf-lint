# large-jest-snapshot

This repository-wide finding comes from an embedded `oxlint` scan using `jest/no-large-snapshots`.

## What it flags

Jest snapshots that exceed configured size limits: 50 lines for inline snapshots or 300 lines for external (`.snap`) snapshot files.

## Why it matters for GitHub Actions

Large snapshots make test failures noisier, reviews slower, and snapshot updates easier to approve without checking the important behavior. They can also add avoidable parsing, transform, diff, and output work to Jest jobs.

## What the scanner does

When this tool sees a JavaScript or TypeScript repository that depends on Jest and has JavaScript CI activity, it may run an embedded `oxlint` check for `jest/no-large-snapshots`.

## Suggested action

Prefer smaller snapshots or direct assertions that pin the behavior under test. External snapshot files (`.snap`) have a higher threshold (300 lines) since they are only loaded when the matching test runs, but inline snapshots in source code are kept to a lower limit (50 lines) because they are parsed on every test execution.

If a large snapshot is intentional and regularly reviewed, allowlist that specific snapshot name in the lint configuration instead of leaving all snapshots unconstrained.

## Verification

Compare Jest wall-clock time and failure output size before and after reducing the flagged snapshots, especially for jobs that update or diff snapshots.

## References

- https://oxc.rs/docs/guide/usage/linter/rules/jest/no-large-snapshots
