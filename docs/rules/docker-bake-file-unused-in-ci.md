# docker-bake-file-unused-in-ci

Build and bake evidence uses shared shell command extraction across all four CI formats. Comments, step labels and printed bake commands do not establish bake adoption or suppress findings for actual builds. Explicit `docker/bake-action` usage remains supported.

Detects repositories that have a Docker bake file while CI bypasses it with direct Docker image builds.

This rule looks for:

- `docker-bake.hcl`
- `docker-bake.json`
- `docker-bake.override.hcl`

and a workflow that runs Docker image builds without invoking `docker buildx bake`.

Why it matters:

- A checked-in bake file usually captures shared Docker build targets, tags, platforms, args, and dependencies.
- Bypassing it in CI can duplicate build configuration.
- CI may also miss BuildKit's ability to schedule related targets as one build graph.

What to do:

- Use `docker buildx bake` in CI when the existing bake targets cover the workflow's images.
- Keep direct builds only when the workflow intentionally builds a one-off image outside the bake file.
