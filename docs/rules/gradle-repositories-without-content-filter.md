# gradle-repositories-without-content-filter

Detects `mavenLocal()` usage in Gradle dependency repositories without a `content` filter.

## Why it matters

`mavenLocal()` makes dependency resolution depend on artifacts installed on the local machine. On a cold CI runner the local repository is empty, so Gradle still pays the lookup for every dependency. On a reused runner it can resolve artifacts that are not available on other machines, making builds non-reproducible.

## Detection

Reports when a `build.gradle`, `build.gradle.kts`, `settings.gradle`, or `settings.gradle.kts` contains `mavenLocal()`.

Does not report when the `mavenLocal` block has a `content { ... }` filter.

## Suggested fix

Remove `mavenLocal()` from CI builds. If local or internal artifacts are required, declare a dedicated internal repository and restrict it with Gradle's `content { includeGroup(...) }` or `exclusiveContent` so unrelated dependencies do not query it.

## Measurement hint

Compare dependency-resolution time and reproducibility on a clean machine before and after removing `mavenLocal()` or narrowing its content filter.
