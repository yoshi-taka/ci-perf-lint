# missing-gradle-build-cache

Task evidence uses the shared Gradle argument parser. Comments, displayed commands, property values and options such as `--task build` or `--args build` are not build/test tasks. Dry-run/help and unresolved Gradle syntax are skipped; supported direct wrappers, scoped tasks and visible command substitutions remain detectable. Existing repository build-cache configuration gates are unchanged.

Flags workflows that visibly run Gradle tasks while no repository-level Gradle build cache configuration is visible. When a CircleCI orb whose alias or name identifies Gradle is used, `settings.gradle`/`build.gradle` present, and no Gradle command is visible, the orb invocation is used as medium-confidence Gradle evidence.

Inferred findings from one orb reference are grouped into a single diagnostic. The orb may already pass `--build-cache` or write `~/.gradle/gradle.properties`; confirm the orb implementation before changing repository settings.

A repository-wide fallback also covers Gradle invoked inside a referenced shell script. It requires a CI command that references an existing script containing `gradle`/`gradlew`, no visible Gradle lifecycle command or Gradle orb, and no `org.gradle.caching=true`.


## Why it matters

Gradle build cache reuses task outputs instead of recomputing them. That is different from dependency caching: the goal here is to avoid repeating build and test work itself.

This rule only fires when:

- the repository looks like it uses Gradle
- the workflow visibly runs Gradle tasks such as `build`, `test`, `assemble`, or `check`
- no visible build cache configuration is found, meaning neither
  - a `buildCache` block in `settings.gradle` or `settings.gradle.kts`, nor
  - `org.gradle.caching=true` in `gradle.properties`

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
