# prefer-native-arm-runner-over-qemu

Detects Docker image builds that target ARM through QEMU emulation in GitHub Actions.

This rule looks for:

- `docker/setup-qemu-action`
- a visible Docker build step in the same job
- ARM targets such as `linux/arm64`

Why it matters:

- Docker documents QEMU emulation as the easiest way to get started, but notes that it can be much slower than native builds for compute-heavy work such as compilation and compression.
- If a workflow mainly builds ARM images, native arm64 runners are often faster and more reliable.
- If a workflow builds both `amd64` and `arm64`, native nodes or per-platform split builds can avoid emulation bottlenecks.

Severity guidance:

- `warning`: ARM-only builds such as `linux/arm64`
- `suggestion`: mixed multi-platform builds such as `linux/amd64,linux/arm64`

What to do:

- For ARM-only image builds, prefer a native arm64 runner when practical.
- For multi-platform image builds, consider native Buildx nodes, per-platform split builds, or cross-compilation instead of relying on QEMU alone.

This rule is advisory. QEMU can still be the simplest choice when a single multi-platform build invocation is more important than raw build speed.
