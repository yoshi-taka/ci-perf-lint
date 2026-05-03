# dockerfile-cargo-build-release-without-cache-mount

Detects Rust Dockerfiles that run `cargo build --release` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `Cargo.toml` in the build context
- `RUN cargo build --release`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Rust release builds are compilation-heavy.
- Without BuildKit cache mounts, Docker rebuilds can repeatedly pay dependency download and compilation costs.
- Depot's optimized Rust Dockerfile uses cache mounts for Cargo registry, Git dependencies, and sccache artifacts.

What to do:

- Add BuildKit cache mounts for Cargo registry and Git caches.
- Use `sharing=locked` for cache mounts that Cargo may write concurrently.
- For larger projects, consider `cargo-chef` and `sccache` as follow-up optimizations.

This rule does not require a full cargo-chef or sccache setup. It flags the narrower missing cache mount on a heavy release build step.
