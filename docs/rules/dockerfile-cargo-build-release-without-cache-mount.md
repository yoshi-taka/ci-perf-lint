# dockerfile-cargo-build-release-without-cache-mount

Warnings require a CI-discovered build with a [recognized persistent builder path](../docker-cache-mount-persistence.md): Depot, configured Blacksmith, or repository-visible Buildkite local Docker state persistence. Unknown/disposable builders are not flagged for missing cache mounts.

Detects Rust Dockerfiles that run `cargo build --release` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a qualifying persistent Docker build discovered from GitHub Actions or Buildkite
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
