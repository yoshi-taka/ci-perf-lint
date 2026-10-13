# gradle-parallel-not-enabled

Detects multi-project Gradle repositories that do not have parallel build execution enabled.

## Why it matters

Gradle parallel execution can reduce CI wall-clock time for multi-project builds by allowing independent modules and tasks to execute concurrently. Many repositories unintentionally run large Gradle builds with the default serial configuration.

## Detection

Reports when:

- The repository uses Gradle
- CI directly executes Gradle lifecycle tasks (`build`, `check`, `test`, `assemble`, `publish`, including qualified task paths and camel-case variants)
- Multiple `build.gradle` or `build.gradle.kts` files are detected (indicating a multi-project build)
- `org.gradle.parallel=true` is not set in `gradle.properties`
- at least one invocation for that root has no visible parallel setting; a tuned command cannot suppress another invocation or another root

Visible Gradle roots under workflow working directories or inline `cd` are included. Each root's own `gradle.properties` and module build files are checked, so a nested project's parallel setting is not mistaken for an absent root-level setting.

Command arguments are parsed separately from comments, echoed text, option values and other commands. Literal cwd, workflow/job/step working directories, `cd`, and `-p`/`--project-dir` determine the project start directory. The nearest ancestor settings file determines the actual build root; wrapper location alone does not select a project.

`--parallel`, `--no-parallel`, `-Dorg.gradle.parallel=...` and literal JVM settings in `GRADLE_OPTS`/`JAVA_OPTS` count only for their own invocation. Arguments after `--` are task options, not Gradle built-ins. Root properties accept Java-properties separators and continuations; later definitions of the same key override earlier ones. Known repository-local Gradle user-home properties are also checked. Unknown/external user homes, initialization scripts, opaque shell control flow and dynamic argument lists are not inferred.

## Exclusions

Does not report when:

- `org.gradle.parallel=true` is set in `gradle.properties`
- `org.gradle.parallel=false` is set
- `--parallel` flag is present in CI commands
- `--no-parallel` flag is present
- Only a single `build.gradle(.kts)` is found (single-module project)
- the command is help/version/dry-run or does not execute a lifecycle task
- explicit parallel settings exist in the applicable CLI, JVM options or properties, including intentional disabling or unknown property values

## Severity

`warning` — consider parallel execution for independent project work, preserving explicit settings and verifying task behavior when tuning.

References: [Gradle CLI](https://docs.gradle.org/current/userguide/command_line_interface.html), [Build environment configuration](https://docs.gradle.org/current/userguide/build_environment.html).
