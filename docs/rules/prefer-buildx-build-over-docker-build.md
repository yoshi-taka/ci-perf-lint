# prefer-buildx-build-over-docker-build

Detects CI jobs that run legacy `docker build` instead of `docker buildx build`.

This rule looks for:

- `docker build ...`

and skips:

- `docker buildx build ...`
- `docker buildx bake ...`
- `docker/build-push-action`

Why it matters:

- buildx uses BuildKit.
- BuildKit gives Docker builds better parallelism, cache features, build-and-push flows, and multi-architecture support.
- In many CI paths, switching from `docker build` to `docker buildx build` is a low-effort build speed improvement.

What to do:

- Replace `docker build` with `docker buildx build` when output behavior can stay equivalent.
- Use `--push`, `--load`, or `--output` intentionally, because buildx output defaults differ from legacy Docker build.
- After switching, consider BuildKit cache mounts or remote cache for expensive build steps.
