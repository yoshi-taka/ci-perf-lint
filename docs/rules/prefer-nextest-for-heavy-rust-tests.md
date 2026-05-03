# prefer-nextest-for-heavy-rust-tests

## What it flags

Flags heavy-looking Rust test jobs that still run `cargo test` without visible `cargo-nextest` adoption.

## Why it matters

`cargo-nextest` is designed as a faster CI-oriented Rust test runner. It can improve wall-clock time for larger workspaces, multi-binary test suites, and integration-heavy jobs by using a different execution model from plain `cargo test`.

The rule does not suggest blindly replacing every Rust test command. Small crates and simple unit-test jobs may not benefit enough to justify a migration.

## Current heuristic

The rule requires all of the following:

- the repository has a root `Cargo.toml`
- the repository does not already show `nextest.toml`, `.config/nextest.toml`, or `nextest` in the root Cargo manifest
- the workflow does not already run `cargo nextest`, `nextest run`, or install `cargo-nextest`
- a job visibly runs `cargo test`
- the `cargo test` step is not only `cargo test --doc`
- the job or repository has a heavy Rust test signal

Heavy Rust test signals include:

- `cargo test --workspace`
- `cargo test --all`
- `cargo test --all-features`
- `cargo test --tests`
- `cargo test --benches`
- a matrix job
- service containers
- job names such as `integration`, `e2e`, `slow`, or `full`
- a Cargo workspace with more than one visible member, or an uncounted workspace

## When to ignore it

Ignore this finding when:

- the Rust test suite is already fast enough
- `cargo test` behavior is intentionally required
- doctests are the only test target
- `cargo-nextest` does not support the repository's required test behavior
- migration risk is higher than the expected CI time savings

## Suggested verification

- Compare `cargo test` and `cargo nextest run` wall-clock time on the same runner
- Use equivalent workspace, package, feature, and target flags
- Keep a separate `cargo test --doc` step if doctests matter
- Check that failure output and flaky-test behavior remain acceptable

## Sources

- https://nexte.st/
- https://nexte.st/docs/benchmarks/
- https://nexte.st/docs/design/how-it-works/
