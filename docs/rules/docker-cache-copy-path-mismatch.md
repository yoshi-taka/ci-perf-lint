# docker-cache-copy-path-mismatch

Detects Dockerfiles that COPY a Gradle or Maven build configuration file that does not exist in the repository, when an alternative with a different extension does exist.

## Why it matters

Dockerfiles often use an early COPY instruction to prime dependency caches before the full source copy:

```
COPY build.gradle.kts .
RUN gradle build -x bootJar
```

If `build.gradle.kts` does not exist but `build.gradle` does, the cache layer is broken — it copies a non-existent file (or fails silently depending on buildkit settings) and the dependency cache is never primed.

This is common after a Gradle Groovy-to-Kotlin migration where the Dockerfile was not updated.

## Detection

Reports when:

- A Dockerfile COPY instruction references a Gradle or Maven configuration file
- That file does not exist at the expected path in the build context
- An alternative file with the correct extension does exist in the same directory

When CircleCI orb commands are opaque, `setup_remote_docker` or an orb `dockerfile:` parameter is used as medium-confidence build evidence. Repository Dockerfiles are inferred only when no explicit `dockerfile:` target is found. This rule needs a trustworthy build context, so targets whose context was inferred are skipped. Findings from explicit targets with medium-confidence evidence are marked with `confidence: medium`.

## Supported file pairs

| COPY source | Alternative |
|---|---|
| `build.gradle` | `build.gradle.kts` |
| `build.gradle.kts` | `build.gradle` |
| `settings.gradle` | `settings.gradle.kts` |
| `settings.gradle.kts` | `settings.gradle` |

## Exclusions

Does not report when:

- The COPY source contains shell variables or build args (`$`, `{`)
- The COPY uses `--from=` (multi-stage build reference)
- The file actually exists in the build context
- No alternative extension file exists in the build context
- The instruction is in a stage that no reachable stage or CI build target references; `dockerfile-unused-build-stage` reports that separately

## Severity

`warning` — the cache layer almost certainly does not work as intended.
