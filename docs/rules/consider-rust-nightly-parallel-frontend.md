# consider-rust-nightly-parallel-frontend

## Why it matters

Cargo compiles independent crates in parallel already. When a large crate remains on the critical path, parallel work inside rustc's frontend may use otherwise idle cores. This is a benchmark candidate, not a guaranteed speedup: CPU availability, cache state, and memory pressure affect results.

This is an exploratory `suggestion`, not a strict warning.

## What it flags

GitHub Actions jobs running `cargo build`, `cargo test`, `cargo check`, or `cargo nextest run` on an explicitly selected nightly without a visible frontend parallelism setting. Findings are consolidated per job.

The scanner recognizes `dtolnay/rust-toolchain` selections (including dated nightlies and simple `env.NAME` references), literal `cargo +nightly...` commands, and literal `RUSTUP_TOOLCHAIN` environment values. It does not recommend switching stable CI to nightly. Miri, fuzz, formatting, and install-only commands do not trigger it.

## Suggested action

On an existing compatible nightly, trial:

```yaml
env:
  RUSTFLAGS: -Dwarnings -Zthreads=0
```

Preserve existing flags. `0` selects the available logical CPU count, rather than hardcoding eight threads. rustc also cooperates with Cargo's jobserver to limit concurrency across crate and frontend work.

Newer toolchains document `--jobs-frontend=0` as the replacement. Check the actual pinned compiler's support before choosing either spelling. Explicit thread limits, including a deliberate single-thread setting, are respected.

## Verification

Compare compilation time, total job time, and peak memory with identical toolchain, runner, features, and cold/warm cache conditions. Parallel frontend work can increase memory consumption; small runners or already CPU-saturated builds may see little benefit or regress. Retain the setting only when measurements justify it.

- [Rust parallel frontend overview](https://blog.rust-lang.org/2023/11/09/parallel-rustc/)
- [Current rustc parallelism options](https://doc.rust-lang.org/rustc/command-line-arguments.html#frontend-parallelism)

## What the scanner does

Workflow, job, and step environment overrides are considered. Existing `-Zthreads`, `--jobs-frontend`, or rustc `--jobs` settings suppress advice, including settings in ancestor `.cargo/config` and `.cargo/config.toml` files. Cargo's own `-j` is not a frontend setting.

Detection is conservative: unresolved matrix/input toolchains, conditional setup actions, dynamic flags, shell-written environment/toolchain state, custom `CARGO_HOME`, and command-line Cargo config overrides are not inferred. Repository toolchain files and arbitrary setup actions are not used to prove nightly selection. Cargo config detection is textual and may abstain for target-specific settings that do not apply to the current runner.
