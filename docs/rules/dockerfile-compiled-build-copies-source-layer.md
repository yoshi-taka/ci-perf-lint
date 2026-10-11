# Dockerfile compiled build copies source layer

## Why it matters

Build inputs used only to produce artifacts do not need their own persisted source layer. A read-only bind mount can reduce intermediate snapshot and cache-export costs, including on disposable CI builders. Input changes still invalidate the build RUN. A final image already containing only artifacts may be unchanged, and the same source files still need to be transferred as build context.

## What it flags

`warning`, medium confidence, for a source COPY followed by a recognized direct build, with literal output locations outside the proposed source mount and only artifact exports to later stages:

- **Go:** simple `COPY . .` into a known WORKDIR, direct `go build -o /outside/path` (one or several builds in the same RUN).
- **Rust:** simple context COPY and `cargo build --target-dir /outside/path`. Cargo's default source-local `target/` is not inferred as safe.
- **Java / Maven:** source-subtree COPY (`src`, `src/main/java`, `src/main/resources`, etc.), a direct `mvn`/`./mvnw` package/verify/install, and a later JAR/WAR export under that WORKDIR's `target/`.
- **Java / Gradle:** the same source-only pattern with `gradle`/`./gradlew` build/assemble/bootJar/shadowJar and a JAR/WAR export under `build/libs/`.

Manifest evidence in the Docker context is required. The warning is emitted once per Dockerfile, at its source COPY.

## Suggested action

For Go, replace the broad source COPY with a temporary context mount while retaining external outputs:

```dockerfile
WORKDIR /src
RUN --mount=type=bind,target=. go build -o /out/app ./cmd/server
```
For Maven/Gradle, keep manifests, wrapper scripts, and project configuration copied separately. Mount only the copied source subtree, leaving normal build output directories writable:

```dockerfile
WORKDIR /app
COPY pom.xml ./
RUN --mount=type=bind,source=src,target=/app/src mvn package -DskipTests
# /app/target is outside /app/src
```

Add compiler/package cache mounts separately when the builder can retain them across runs; source bind mounts do not require that persistence. Preserve final-stage artifact copies and do not mechanically add `rw`: writes inside a writable bind are discarded when the RUN ends.

## Verification

Compare intermediate cache size, export bytes/duration and cold/warm rebuild time. Test artifact equivalence, generated/embedded assets, and read-only source compatibility, including Java plugin/code-generation behavior and Rust build scripts. Arbitrary build plugins and application code can write to source paths even without visible shell mutations; static evidence is not a proof of compatibility. There is no automatic fix.

## What the scanner does

It tracks literal WORKDIRs, source COPY regions, direct compile output locations, and `COPY --from` artifact consumers. It declines ambiguous outputs, whole-project Java COPY, later RUNs using that builder, inherited builder consumers, generator/opaque prefix RUNs, metadata-changing COPY flags, and stage-generated inputs that a source bind could hide. It does not infer custom Java build directories, multi-module project routing, Cargo implicit targets, cross-compiler wrappers, or script behavior.

Existing binds are recognized by type and normalized target coverage, including omitted `type=bind` and `dst`/`destination` aliases. A `.git` or manifest-only bind does not cover the whole source tree. A cache mount is not a source bind.

## Sources

- https://depot.dev/blog/ultimate-guide-to-docker-build-cache#bind-mounts-for-temporary-file-access
- https://docs.docker.com/reference/dockerfile/#run---mounttypebind
- https://github.com/langgenius/dify/blob/eb0b4fd94c3d3d6128e2933999e8b416b7fbe699/dify-agent-runtime/docker/Dockerfile
- https://github.com/go-gitea/gitea/blob/aa32eb97fad8224cc0ef9d4b40df255b8026dd49/Dockerfile
