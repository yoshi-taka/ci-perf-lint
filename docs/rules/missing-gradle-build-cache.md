# missing-gradle-build-cache

Flags workflows that visibly run Gradle tasks while no repository-level Gradle build cache configuration is visible.

## Why it matters

Gradle build cache reuses task outputs instead of recomputing them. That is different from dependency caching: the goal here is to avoid repeating build and test work itself.

This rule only fires when:

- the repository looks like it uses Gradle
- the workflow visibly runs Gradle tasks such as `build`, `test`, `assemble`, or `check`
- no visible `buildCache` configuration appears in `settings.gradle` or `settings.gradle.kts`

## Suggested fix

If this repository repeats the same Gradle tasks in CI, configure Gradle build cache in the repository and keep it only if total job time improves.

## Measurement hint

Compare:

- Gradle task duration
- reported build-cache hits
- total job time

## References

- https://docs.gradle.org/current/userguide/build_cache.html
- https://docs.gradle.org/current/userguide/build_cache_use_cases.html
