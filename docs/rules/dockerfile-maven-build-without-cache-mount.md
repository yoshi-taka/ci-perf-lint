# dockerfile-maven-build-without-cache-mount

Detects Java Dockerfiles that run Maven build goals without a visible BuildKit cache mount on the same instruction.

This rule looks for:

- a Docker build discovered from GitHub Actions
- `pom.xml` in the build context
- `RUN mvn package`, `RUN mvn clean package`, `RUN mvn install`, or `RUN mvn verify` through `mvn`, `mvnw`, or `./mvnw`
- no `--mount=type=cache` on that Dockerfile instruction

Why it matters:

- Maven builds reuse downloaded dependencies and plugins from the local repository.
- Without a BuildKit cache mount such as `/root/.m2`, Docker rebuilds can repeatedly pay dependency and plugin download costs.

What to do:

- Add a BuildKit cache mount for `/root/.m2` to the Maven build step.
- Keep dependency resolution and application build steps separated when practical.

This rule intentionally does not require tests to be skipped or a specific Maven version.
