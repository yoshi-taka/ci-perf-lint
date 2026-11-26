# gradle-formatter-apply-in-compile

Detects Gradle compile tasks that depend on `spotlessApply`.

## Why it matters

`spotlessApply` rewrites source files. Wiring it into `compileJava`, `compileKotlin`, or another compile task makes every CI compile mutate the workspace:

- source files can change after checkout, so build outputs and caches become non-reproducible
- parallel compile tasks can race on the same files
- build-cache keys and remote cache reuse become unreliable
- CI can succeed while leaving a dirty working tree

## Detection

Reports when a `build.gradle` or `build.gradle.kts` contains a compile task dependency on `spotlessApply`, for example:

```groovy
compileJava.dependsOn "spotlessApply"
```

```kotlin
tasks.named("compileJava") { dependsOn("spotlessApply") }
```

`spotlessCheck` and unrelated `spotlessApply` usage are not reported.

## Suggested fix

Use `spotlessCheck` in CI, or move formatting to a separate job. Run `spotlessApply` locally or as an explicit formatting step, not as part of compilation.

## Measurement hint

Compare compile duration, build-cache hits, and working-tree diffs before and after removing the compile dependency.
