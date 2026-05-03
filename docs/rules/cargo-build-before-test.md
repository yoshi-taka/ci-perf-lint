# cargo-build-before-test

Detects redundant `cargo build` steps that immediately precede `cargo test` with identical build conditions.

This rule looks for:

- a `cargo build` step
- followed within 3 steps by `cargo test`
- where both commands use the same profile, target, features, package scope, and target selection
- where `cargo test` does not use `--no-run`

Why it matters:

- `cargo test` compiles the required test targets automatically.
- A preceding `cargo build` with identical conditions usually rebuilds the same artifacts and adds avoidable compile time.
- On larger Rust repositories this can add noticeable wall-clock and CPU time.

What to do:

- Remove the redundant `cargo build` step.
- If you need an explicit compile phase, use `cargo test --no-run` instead.
- Compare job runtime with and without the `cargo build` step.

Exceptions:

- This rule does not flag when `cargo test --no-run` is present, because that explicitly requests a compile-only phase.
- This rule does not flag when build conditions differ (profile, target, features, package scope, or target selection), because the build may serve a different purpose.
