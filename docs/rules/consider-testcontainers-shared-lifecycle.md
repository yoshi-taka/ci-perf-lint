# consider-testcontainers-shared-lifecycle

## Why it matters

The [Testcontainers JUnit 5 extension](https://java.testcontainers.org/test_framework_integration/junit_5/) starts and stops instance `@Container` fields for each test method. Static fields are shared within one test class. Class-scoped lifecycle can avoid repeated startup, but requires deterministic state reset and changes isolation.

This is a **suggestion**, not a strict warning. A fresh process per test may be intentional. The scanner does not prove that sharing is safe, estimate the actual number of CI starts, or establish a measured speedup.

## What it flags

A single-class Java test file with explicit JUnit 5 `Test` and Testcontainers `Container`/`Testcontainers` imports, `@Testcontainers`, at least two `@Test` annotations, and a directly initialized non-static `@Container` field of an explicitly imported Testcontainers type. Ambiguous or reassigned receiver names, explicit reuse, and `@Execution` configurations are skipped.

## Suggested action

If tests do not depend on fresh-process, startup, recovery, or persistent-state isolation, benchmark a **class-scoped static container** with a reliable reset between tests. Include reset cost in the comparison. Preserve queue/database/application state semantics, test order independence, and cleanup. Retain per-test lifecycle when equivalent clean state cannot be guaranteed.

This is distinct from experimental [cross-run reusable containers](https://java.testcontainers.org/features/reuse/), which upstream explicitly says are **not suited for CI**. Do not recommend `withReuse(true)`, `TESTCONTAINERS_REUSE_ENABLE=true`, disabling Ryuk, or bypassing cleanup for routine CI speedups.

Container-start parallelism is also not test-method parallelism. The JUnit 5 documentation warns that parallel test execution is unsupported. This rule does not enable either; static containers do not prove independence or sufficient runner resources.

## Verification

Measure actual container start count, state-reset time, image-pull cost, peak memory, and total suite duration. Run tests individually and in changed orders, under the existing execution policy. Verify fresh-state, restart, transaction, FIFO, and background-consumer assumptions where relevant. Keep the original lifecycle if test isolation changes.

## What the scanner does

Uses the same bounded Java test-source scan as `testcontainers-fixed-sleep-after-start`, gated on JVM evidence. Masks non-code and requires explicit imports and a single class. Nested classes, inheritance, Kotlin, other Testcontainers language clients, manual lifecycle hooks, custom annotations, wildcard imports, and execution-graph analysis are outside this first detector. The scanner cannot prove which source tests CI executes.
