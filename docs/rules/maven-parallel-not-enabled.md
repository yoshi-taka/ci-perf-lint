# maven-parallel-not-enabled

Detects multi-module Maven repositories that run lifecycle goals in CI without parallel module execution.

## Why it matters

Maven builds modules serially by default. For multi-module projects, `--threads` lets independent modules build and test in parallel, which can substantially reduce CI wall-clock time. Many repositories run large Maven builds with the default single-threaded configuration.

## Detection

Reports when:

- The repository uses Maven (`pom.xml` or `mvnw`)
- CI executes a Maven lifecycle goal (`compile`, `test`, `package`, `verify`, `install`, `deploy`, `integration-test`)
- The build looks multi-module: the root `pom.xml` declares `<modules>`, or more than one `pom.xml` is present
- No `-T` / `--threads` flag is used in the CI Maven command or root `.mvn/maven.config`

## Exclusions

Does not report when:

- `-T` or `--threads` is already passed in CI or configured in `.mvn/maven.config` (commented flags do not count)
- Only a single `pom.xml` is found and the root POM has no `<modules>`
- No Maven lifecycle goal runs in CI

## Severity

`warning` — parallel execution is a large, low-risk win for most multi-module builds, but plugins that are not marked `@threadSafe` can break under parallelism.

## Caveats

Always check Maven's thread-safety warnings (it lists plugins whose goals are not marked `@threadSafe`). Replace or isolate those plugins before relying on parallel execution, and validate the build and test results.
