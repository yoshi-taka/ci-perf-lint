# java-cds-opportunity-for-repeated-startup

## What It Does

Detects Java repositories where short-lived JVM startup likely dominates CI runtime and suggests evaluating CDS/AppCDS or related startup amortization techniques.

## Why It Matters

Each short-lived JVM invocation spends a significant fraction of wall time on class loading, bytecode verification, and JIT warmup. When CI pipelines repeatedly launch independent JVM processes (e.g. per-test-class forks, Gradle test executors, Maven Surefire forks), this overhead adds up.

Class Data Sharing (CDS/AppCDS) lets the JVM archive resolved class metadata so subsequent launches skip much of the class-loading phase. For repeated JVM startup patterns in CI, this can meaningfully reduce total workflow duration.

## Triggers

**Repository evidence (any of):**

- `pom.xml` (Maven)
- `build.gradle` / `build.gradle.kts` (Gradle)
- `gradlew` / `gradlew.bat` (Gradle wrapper)
- `src/main/java` or `src/test/java` (Java source)

**Workflow evidence (2+ occurrences across workflows):**

- `mvn test`, `mvn verify`, or other Maven lifecycle commands
- `gradle test`, `./gradlew test`
- `java -jar ...`
- `spring-boot:run` in CI

## Non-Triggers

- Repositories already using `-Xshare`, `-XX:SharedArchiveFile`, `-XX:ArchiveClassesAtExit`, `-XX:DumpLoadedClassList`, or other CDS/AppCDS flags
- Native-image-first repos (GraalVM native-image, Quarkus native builds)
- Repositories with fewer than 2 JVM workflow commands
- Release-only image builds without repeated JVM test startup
- Single long-running JVM execution (e.g. a single `java -jar` application server)

## Severity

`warning` — exploratory performance opportunity

## Score Boosters

Higher score when any of these are detected:

- Maven Surefire/Failsafe `forkCount` configuration
- `reuseForks=false` (creates fresh JVM per test class)
- Gradle `maxParallelForks > 1`
- Spring Boot dependency
- Integration / e2e / smoke test steps
- Matrix builds (multiplies JVM startup count)
- Repeated Java workflow steps across jobs
- Surefire or Failsafe plugin presence

## Advisory

CDS/AppCDS introduces archive generation and setup cost. The benefit depends on:

- How many times similar JVM startup patterns repeat
- Archive generation overhead relative to total CI time
- Whether test environment supports archive reuse (ephemeral CI runners may need to regenerate per run)

**Always measure before and after.** Compare total workflow duration, not isolated JVM startup latency.
