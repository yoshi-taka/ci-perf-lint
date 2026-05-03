# matrix-test-job-without-test-sharding

## What it flags

Flags test jobs that use a shard-like matrix but do not visibly pass the matrix value into the test command.

## Why it matters

Matrix parallelization only reduces test time when each matrix leg runs a different subset of tests.

If the matrix looks like it was meant for sharding but the test runner does not consume the shard value, the workflow may be running the full test suite multiple times instead of partitioning it.

## Current heuristic

The rule looks for:

- a job with `strategy.matrix`
- shard-like matrix keys such as `shard`, `split`, `partition`, `chunk`, `node_index`, or `ci_node_index`
- visible test commands such as `jest`, `vitest`, `playwright`, `pytest`, or `npm/pnpm/yarn/bun test`
- no visible use of the matrix key inside the test command

## When to ignore it

Ignore this finding when:

- the matrix is intentionally repeating the same tests across environments or versions
- the test sharding happens inside a wrapper script that is not visible from the workflow YAML
- the matrix key name happens to look shard-like but is not actually used for partitioning

## Suggested verification

- Compare per-leg test counts before and after wiring the matrix value into the runner
- Check whether total workflow runtime falls as expected
- Confirm that the matrix was actually intended for partitioning rather than environment coverage

## Sources

- https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs
- https://jestjs.io/docs/cli#--shard
- https://playwright.dev/docs/test-sharding
