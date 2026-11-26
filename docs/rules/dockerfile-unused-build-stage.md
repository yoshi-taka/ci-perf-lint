# dockerfile-unused-build-stage

Detects named or numbered Dockerfile stages that no reachable stage or CI build target references.

## Why it matters

BuildKit only executes stages reachable from the requested target (the final stage by default) and from `FROM`/`COPY --from` references. An unreferenced stage is skipped entirely. Stale cache-priming steps or invalid `COPY` paths in that stage never affect the image, so leaving them in place hides rot and misleads reviewers.

A common case is a Gradle cache stage that was copied early in development but later disconnected:

```dockerfile
FROM gradle:8 AS cache
COPY build.gradle.kts .
RUN ./gradlew dependencies

FROM gradle:8 AS build
COPY --from=source /app /app
```

The `cache` stage is never referenced, so BuildKit does not run it and the missing `build.gradle.kts` never fails the build.

## Detection

Reports when:

- A Dockerfile defines more than one stage
- A stage is not the requested target and is not reachable through `FROM <stage>`, `FROM <index>`, `COPY --from=<stage|index>`, or `RUN --mount=...,from=<stage|index>`
- Stage relationships can be resolved statically

The diagnostic points at the unreachable `FROM` line.

## Exclusions

Does not report when:

- The Dockerfile has a single stage
- The unreachable stage is explicitly built by CI via `--target`
- A `FROM` image uses build args or variables that make stage relationships unresolvable
- Duplicate stage aliases make reachability ambiguous

## Severity

`warning` — the stage does not affect the built image; remove it or wire it into a reachable stage.
