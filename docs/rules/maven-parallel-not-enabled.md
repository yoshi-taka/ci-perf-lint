# maven-parallel-not-enabled

Detects multi-module Maven repositories that run lifecycle goals in CI without parallel module execution.

## Why it matters

Maven builds modules serially by default. For multi-module projects, `--threads` lets independent modules build and test in parallel, which can substantially reduce CI wall-clock time. Many repositories run large Maven builds with the default single-threaded configuration.

## Detection

Reports when:

- The repository uses Maven (`pom.xml` or `mvnw`)
- CI executes a Maven lifecycle goal (`compile`, `test`, `package`, `verify`, `install`, `deploy`, `integration-test`)
- The build looks multi-module: the root `pom.xml` declares `<modules>`, or more than one `pom.xml` is present
- At least one CI Maven lifecycle command lacks `-T` / `--threads`, and root `.mvn/maven.config` does not configure parallel execution

## Exclusions

Does not report when:

- Every CI Maven lifecycle command passes `-T` or `--threads`, or parallel execution is configured in `.mvn/maven.config` (commented flags do not count). A tuned command does not suppress a separate untuned command or job.
- Only a single `pom.xml` is found and the root POM has no `<modules>`
- No Maven lifecycle goal runs in CI

Lifecycle goals and thread settings are parsed as command arguments. Echoed examples, comments, properties, profile names, settings paths and other option values are not lifecycle goals or thread flags. `-T2`, `-T=2`, `-T 1C`, `--threads=2` and fractional core counts are recognized only for their own invocation. `--` ends global-option parsing. Help/version, heredoc scripts, command substitutions, dynamic arguments and opaque shell control flow are not inferred.

Literal `MAVEN_ARGS` settings are considered (Maven 3.9+); workflow/job/step ENV and inline assignments apply only to the appropriate invocation. `MAVEN_OPTS` is a JVM option string and does not configure Maven's `--threads`. Root `.mvn/maven.config` uses the same argument analysis, including quoted option values, whole-line comments and multiline options. Unknown configuration is conservatively excluded rather than declared untuned.

## Severity

`warning` — parallel execution is a large, low-risk win for most multi-module builds, but plugins that are not marked `@threadSafe` can break under parallelism.

## Caveats

Always check Maven's thread-safety warnings (it lists plugins whose goals are not marked `@threadSafe`). Replace or isolate those plugins before relying on parallel execution, and validate the build and test results.
