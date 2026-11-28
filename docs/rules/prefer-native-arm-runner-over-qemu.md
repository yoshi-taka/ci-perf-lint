# prefer-native-arm-runner-over-qemu

Detects Docker image builds that target ARM through QEMU emulation in GitHub Actions.

This rule looks for:

- `docker/setup-qemu-action`
- a visible Docker build step in the same job
- `docker/build-push-action`, `useblacksmith/build-push-action`, and
  `depot/build-push-action` / `depot/bake-action` are recognized
- literal `docker build` / `docker buildx build` / `depot build` / `depot bake`
  steps with `--platform` are recognized
- ARM targets such as `linux/arm64`; `depot-ubuntu-*-arm` and `depot-macos-*`
  runners count as native Arm runners

On a job whose builds go through Depot, the suggestion changes: Depot routes
each requested platform to a native builder, so `docker/setup-qemu-action` is
likely redundant. Depot does not explicitly say QEMU setup is unnecessary; the
advice is conditional on every build in the job using Depot without
`buildx-fallback`. See
[Depot Arm containers](https://depot.dev/docs/container-builds/how-to-guides/arm-containers)
and [runner types](https://depot.dev/docs/github-actions/runner-types).

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
