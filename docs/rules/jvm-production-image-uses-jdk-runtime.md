# jvm-production-image-uses-jdk-runtime

## What It Does

Detects Dockerfiles where the final production/runtime stage uses a full JDK base image even though it only runs a Java application.

## Why It Matters

A JDK includes development tools (compilers, debuggers, profilers, keytool, etc.) that are unnecessary in production runtime images. Keeping them in the final image increases:

- Image size (JDK is typically 2-3x larger than a JRE)
- Image push/pull time
- Deployment latency
- Vulnerability scanner surface area
- Runtime attack surface

## Detection Logic

All of the following must be true:

**1. Repository contains Dockerfile build targets** (detected via workflow build steps).

**2. Final Dockerfile stage uses a JDK-like base image**, for example:
- `openjdk:<tag>` (tag without `-jre`)
- `eclipse-temurin:<tag>` with `-jdk` in tag
- `amazoncorretto:<tag>` (Corretto only ships JDK)
- `bellsoft/libericaopenjdk:<tag>`
- `azul/zulu-openjdk:<tag>`
- `ibm-semeru-runtimes:<tag>` with `-jdk` in tag
- `sapmachine:<tag>` with `-jdk` in tag
- `ghcr.io/graalvm/jdk:<tag>`

**3. Final stage runs a Java application:**
- `ENTRYPOINT ["java", ...]`
- `CMD ["java", ...]`
- `ENTRYPOINT java ...`
- `CMD java ...`
- `org.springframework.boot.loader.launch.JarLauncher`

**4. Final stage does not appear to need JDK tools:**
- No `javac`, `jar`, `jlink`, `jmod`, `jpackage`, `jshell`, `jcmd`, `jmap`, `jstack`, `jfr`, `jdeps`, or `keytool` invocations

## Non-Triggers

- Final stage uses JRE/runtime/distroless base image (`-jre`, `runtime`, `distroless` in tag)
- Final stage uses JDK tools (`javac`, `jar`, `jlink`, etc.)
- Dockerfile path contains test/ci/dev/builder markers
- Final stage alias is test/ci/dev/builder
- Single-stage JDK without Java entrypoint

## Severity

`warning` — image size and security optimization

## Score Boosters

Higher score when any of these are detected:

- Final stage COPY references `target/*.jar` or `build/libs/*.jar`
- Multi-stage Dockerfile (separate builder stage exists)
- No package-manager installations in final stage
- Spring Boot JarLauncher entrypoint
- Repository has Maven (`pom.xml`) or Gradle signals

## Advisory

Always verify the base image tag is correct before switching. Some distributions share the same tag name for JDK and JRE variants (e.g., `eclipse-temurin:17` is JRE while `openjdk:17` is JDK). Measure image size, push/pull time, and vulnerability scan results before adopting the change.
