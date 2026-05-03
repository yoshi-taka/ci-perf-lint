# dockerfile-gradle-dependencies-without-cache-mount

Detects Java Dockerfiles that run Gradle dependency resolution without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `build.gradle`, `build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts` in the build context
- `RUN gradle dependencies`, `RUN gradlew dependencies`, or `RUN ./gradlew dependencies`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Gradle dependency resolution populates Gradle user home with dependency and plugin cache data.
- Without a BuildKit cache mount such as `/cache/.gradle` or `/root/.gradle`, Docker rebuilds can repeatedly download dependencies and plugin artifacts.
- Depot's optimized Gradle Dockerfile mounts Gradle user home during dependency resolution.

What to do:

- Add a BuildKit cache mount for Gradle user home.
- If `GRADLE_USER_HOME` points to `/cache/.gradle`, mount `/cache/.gradle`.
- Otherwise, `/root/.gradle` is a common default in root-based build stages.

This rule focuses on the dependency resolution step and does not require a specific Gradle distribution strategy.
