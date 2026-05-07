# gradle-parallel-not-enabled

Detects multi-project Gradle repositories that do not have parallel build execution enabled.

## Why it matters

Gradle parallel execution can reduce CI wall-clock time for multi-project builds by allowing independent modules and tasks to execute concurrently. Many repositories unintentionally run large Gradle builds with the default serial configuration.

## Detection

Reports when:

- The repository uses Gradle
- CI executes Gradle lifecycle tasks (`build`, `check`, `test`, `assemble`, `publish`)
- Multiple `build.gradle` or `build.gradle.kts` files are detected (indicating a multi-project build)
- `org.gradle.parallel=true` is not set in `gradle.properties`
- No `--parallel` flag is used in CI Gradle commands

## Exclusions

Does not report when:

- `org.gradle.parallel=true` is set in `gradle.properties`
- `org.gradle.parallel=false` is set
- `--parallel` flag is present in CI commands
- `--no-parallel` flag is present
- Only a single `build.gradle(.kts)` is found (single-module project)

## Severity

`warning` — parallel execution is safe for most multi-project builds and the setting is purely additive.
