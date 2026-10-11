# dockerfile-go-mod-download-without-cache-mount

Warnings require a CI-discovered build with a [recognized persistent builder path](../docker-cache-mount-persistence.md): Depot, configured Blacksmith, or repository-visible Buildkite local Docker state persistence. Unknown/disposable builders are not flagged for missing cache mounts.

Detects Go Dockerfiles that run `go mod download` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a qualifying persistent Docker build discovered from GitHub Actions or Buildkite
- `go.mod` in the build context
- `RUN go mod download`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Go module downloads populate the module cache.
- Without a BuildKit cache mount such as `/go/pkg/mod`, Docker rebuilds can repeatedly download dependencies.
- Depot's optimized Go Dockerfile mounts the module cache during dependency download.

What to do:

- Add a BuildKit cache mount for `/go/pkg/mod` to the `go mod download` step.
- Keep `go.mod` and `go.sum` copied before broader source files.
- Consider running `go mod verify` after download when it fits the repository's policy.

This rule focuses on Docker build cache behavior, not general Go module correctness.
