# dockerfile-maven-go-offline-without-cache-mount

Warnings require a CI-discovered build with a [recognized persistent builder path](../docker-cache-mount-persistence.md): Depot, configured Blacksmith, or repository-visible Buildkite local Docker state persistence. Unknown/disposable builders are not flagged for missing cache mounts.

Detects Java Dockerfiles that run `mvn dependency:go-offline` without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a qualifying persistent Docker build discovered from GitHub Actions or Buildkite
- `pom.xml` in the build context
- `RUN mvn dependency:go-offline`, `RUN mvnw dependency:go-offline`, or `RUN ./mvnw dependency:go-offline`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Maven dependency resolution populates the local Maven repository.
- Without a BuildKit cache mount such as `/root/.m2`, Docker rebuilds can repeatedly download dependencies and plugin artifacts.
- Depot's optimized Maven Dockerfile mounts the Maven local repository during dependency resolution.

What to do:

- Add a BuildKit cache mount for `/root/.m2` to the dependency resolution step.
- Keep `pom.xml` copied before broader source files.

This rule focuses on Docker build cache behavior, not general Maven correctness.
