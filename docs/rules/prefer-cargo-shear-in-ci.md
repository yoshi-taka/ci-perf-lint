# prefer-cargo-shear-in-ci

Suggests running an unused-dependency check (`cargo-shear` or `cargo-machete`) in CI for Rust workspaces.

## What it detects

- a `Cargo.toml` that declares dependencies, for a single crate or a workspace (`[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, `[workspace.dependencies]`, or a workspace with members)
- no visible unused-dependency check in CI: no `cargo shear` / `cargo machete` / `cargo udeps`, no `cargo-shear` / `cargo-machete` install step
- no config in `Cargo.toml` metadata (`metadata.shear` / `metadata.machete`) and no config file (`.cargo-shear.toml`, `.shear.toml`, `shear.toml`, `.machete.toml`)

A crate that declares no dependencies is skipped, since there is nothing to check.

## Why it matters

Cargo compiles every dependency declared in `Cargo.toml`, even when the crate never imports it, so an unused dependency still costs build time and cache space. An unused dependency can also create a spurious synchronization point in the build graph that blocks later crates. Removing unused dependencies typically cuts a few percent of build time and shrinks the target directory, with larger wins in big workspaces or when a heavy dependency is declared but unused.

`cargo-shear` is the current best tool: it uses rust-analyzer's parser to analyze sources statically (no compile needed), runs once on a single platform for all targets, and also detects misplaced dependencies and unlinked source files. It supports `--fix`, JSON output, and CI exit codes. `cargo-machete` is a faster but less precise alternative.

## Suggested action

Add a CI step that runs `cargo-shear` on the workspace and fails on findings, for example:

```sh
cargo install cargo-shear && cargo shear --deny-warnings
```

Add ignore configuration for the few false positives: macro-generated imports (use `--expand` on nightly), dependencies used only through features or conditional compilation, and cargo-hakari `workspace-hack` crates.

## Measurement

Compare `cargo build` / `cargo check --workspace` wall-clock time, dependency count, and target directory size before and after removing unused dependencies.
