# testcontainers-fixed-sleep-after-start

## Why it matters

[Testcontainers `start()` applies startup and wait strategies](https://java.testcontainers.org/features/startup_and_waits/). A literal `Thread.sleep(...)` immediately afterwards adds its full fixed delay even when a service is ready sooner, and can still be too short on a slower runner.

The default listening-port check is not proof of application readiness. A deliberate stabilization interval or elapsed-time assertion may also be valid. The warning calls for reviewing the delay and using the right bounded condition, **not blindly deleting synchronization**. No independent whole-suite speedup was measured.

## What it flags

Java test sources with a directly imported Testcontainers container type, an unambiguous local/field initialization using that type, and adjacent statements:

```java
database.start();
Thread.sleep(5_000L);
```

Positive integer millisecond literals are detected. `this.database.start()` is supported. Comments between the statements do not suppress the finding. No arbitrary sleep-duration threshold is used.

## Suggested action

Determine what the delay protects. Configure an appropriate bounded `waitingFor(Wait.forHttp(...))`, healthcheck, stable log condition, or application-specific readiness check for startup padding. If the test actually requires elapsed time, retain that semantic and document it. Keep explicit timeout bounds and cleanup.

Do not shorten startup timeouts, disable checks, enable cross-run reuse, or remove assertions just to eliminate the warning. Awaiting the first open port can be insufficient for migrations, leader election, message consumers, and background initialization.

## Verification

Compare startup-to-ready and total suite time across repeated cold starts and slow-runner conditions. Verify readiness, stabilization, failure timeout, and cleanup behavior. One passing fast run is not sufficient evidence that synchronization is unnecessary.

## What the scanner does

Repository collector gated on JVM evidence. Scans at most 200 sorted `.java` files under `src/test/java` or `src/integrationTest/java` (including nested modules), each at most 500,000 UTF-16 code units. Comments, strings, characters, and Java text blocks are masked while preserving locations. Explicit imports, matching constructor types, unique receiver declarations, and no receiver reassignment are required.

This is not a Java parser or symbol resolver. Wildcard/fully-qualified type use, subclasses, inherited or returned containers, Kotlin, Node/Go/.NET/Python Testcontainers, dynamic durations, TimeUnit sleeps, non-adjacent statements, and ambiguous names are outside the initial detector. Source presence does not prove that a test is selected by CI. A shadowed `Thread` type is skipped.
