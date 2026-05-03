# dockerfile-go-build-without-cache-mount

Detects Go Dockerfiles that run `go build` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a Docker build discovered from GitHub Actions
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
