# prefer-buildx-bake-for-multiple-images

Detects CI jobs that build multiple Docker images or targets through separate Docker build invocations.

This rule looks for:

- two or more `docker build` or `docker buildx build` commands in the same job
- multiple `docker/build-push-action` steps in the same job
- no visible `docker buildx bake` invocation in that job

Why it matters:

- Repeated Docker build commands make the CI script own build scheduling and target ordering.
- `docker buildx bake` can model multiple images as one BuildKit target graph.
- bake files reduce duplicated tags, platforms, args, outputs, and dependency wiring across many image builds.

What to do:

- Move repeated image builds into `docker-bake.hcl`.
- Use a bake group for images that are released together.
- Invoke `docker buildx bake` from CI and compare Docker build wall-clock time and runner minutes.
