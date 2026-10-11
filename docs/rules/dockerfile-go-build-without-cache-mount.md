# dockerfile-go-build-without-cache-mount

Warnings require a CI-discovered build with a [recognized persistent builder path](../docker-cache-mount-persistence.md): Depot, configured Blacksmith, or repository-visible Buildkite local Docker state persistence. Unknown/disposable builders are not flagged for missing cache mounts.

Detects Go Dockerfiles that run `go build` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a qualifying persistent Docker build discovered from GitHub Actions or Buildkite
- `go.mod` in the build context
- `RUN go build`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Go builds can reuse downloaded modules and compiled package artifacts.
- Without BuildKit cache mounts for `/go/pkg/mod` and `/root/.cache/go-build`, Docker rebuilds can repeatedly pay module and compile costs.
- Depot's optimized Go Dockerfile mounts both caches during the build step.

What to do:

- Add BuildKit cache mounts for `/go/pkg/mod` and `/root/.cache/go-build` to the `go build` step.
- Keep dependency download and application build steps separated when practical.

This rule flags the narrow missing cache mount on a Go build step. It does not require a specific runtime image or deployment layout.
