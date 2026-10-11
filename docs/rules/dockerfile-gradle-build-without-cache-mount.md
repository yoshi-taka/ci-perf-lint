# dockerfile-gradle-build-without-cache-mount

Warnings require a CI-discovered build with a [recognized persistent builder path](../docker-cache-mount-persistence.md): Depot, configured Blacksmith, or repository-visible Buildkite local Docker state persistence. Unknown/disposable builders are not flagged for missing cache mounts.

Detects Java Dockerfiles that run Gradle build tasks without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a qualifying persistent Docker build discovered from GitHub Actions or Buildkite
- `build.gradle`, `build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts` in the build context
- `RUN gradle build`, `RUN ./gradlew build`, `assemble`, `bootJar`, or `shadowJar`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Gradle builds reuse downloaded dependencies, plugin artifacts, and build cache data from Gradle user home.
- Without a BuildKit cache mount, Docker rebuilds can repeatedly pay those costs.
- Depot's optimized Gradle Dockerfile mounts Gradle user home during the build step.

What to do:

- Add a BuildKit cache mount for Gradle user home.
- Keep `--build-cache` or `org.gradle.caching=true` enabled when it fits the repository.

This rule intentionally does not require tests to be skipped or the daemon to be disabled, because those choices are repository policy dependent.
