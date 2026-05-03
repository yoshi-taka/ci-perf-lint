# dockerfile-cargo-install-without-locked

Detects Rust Dockerfiles that install external Rust tools with `cargo install` without `--locked`.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `Cargo.toml` in the build context
- `RUN cargo install ...`
- no `--locked` flag
- no `--path` flag

Why it matters:

- Docker builds should install reproducible tool versions.
- `cargo install --locked` uses the installed crate's lockfile when available.
- Without `--locked`, tools such as `cargo-chef` or `sccache` can resolve a different dependency graph during image construction.

What to do:

- Add `--locked` to external tool installs, for example `cargo install cargo-chef sccache --locked`.
- Keep local project installs such as `cargo install --path .` separate; this rule does not flag those.

This rule is focused on Docker build reproducibility for external Rust tooling.
