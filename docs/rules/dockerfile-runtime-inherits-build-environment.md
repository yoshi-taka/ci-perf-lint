# dockerfile-runtime-inherits-build-environment

## Why it matters

Building an executable and running it in the same stage ancestry ships the compiler base and build layers with the application. An independent runtime stage can reduce final image size, cold pulls, extraction, and pushes. Merely writing `FROM builder AS runtime` keeps the builder's layers.

## What it flags

A `warning` with medium confidence when all of these are visible:

- The final stage uses an official Go or Rust compiler image, directly or through earlier stage aliases.
- A `RUN` in that ancestry invokes `go build` or `rustc` with a literal `-o` output file.
- The effective `ENTRYPOINT` or `CMD` directly executes that same resolved file path.
- The Dockerfile path and final alias do not identify development, CI, or test execution. A final build/builder alias is also excluded.

The finding is emitted once per Dockerfile at its final `FROM`, with the compile line and executable in the message. Explicit `WORKDIR` values and earlier-stage inheritance are tracked. Already separated builds that copy a binary into an independent runtime stage are not flagged.

## Suggested action

```dockerfile
FROM golang:1.24 AS builder
WORKDIR /src
COPY . .
RUN go build -o /out/app .

FROM debian:bookworm-slim
COPY --from=builder /out/app /usr/local/bin/app
ENTRYPOINT ["/usr/local/bin/app"]
```

Select a runtime compatible with the executable's ABI and include required shared libraries, certificates, timezone data, and application assets. A distroless runtime may also fit. Use `scratch` only after verifying static linkage and supplying any necessary runtime assets. Applications that deliberately compile user code or load compiler-dependent plugins may need their build tools at runtime.

## Verification

Compare final image size and cold pull, extraction, and push times. Test application startup and behavior, native libraries, certificates, and assets. This rule identifies a layout opportunity, not a measured speedup.

## What the scanner does

Uses CI-discovered Dockerfiles, the final stage, and earlier stage aliases. It matches literal output and execution paths rather than guessing from stage names or a generic `npm run build`. JSON and simple shell-form commands are supported. Relative paths require a known `WORKDIR`; bare commands relying on `PATH` are not matched.

Variable-based paths, shell control flow, `cd` inside a `RUN`, pipelines, script wrappers, Cargo's implicit outputs, and Java/.NET build outputs are not inferred. Node development dependency retention requires additional install/prune/copy tracking and is outside this rule. CI-selected intermediate build targets are not modeled by the shared Dockerfile target collector.

The narrower build/runtime finding takes precedence over `dockerfile-runtime-image-uses-heavy-base` when its evidence matches. Other cache/context rules remain independent.

## Sources

- https://docs.docker.com/build/building/multi-stage/
- https://depot.dev/blog/optimize-your-dockerfile-for-5x-faster-builds
- https://github.com/slimtoolkit/examples/blob/947d1ef8b5757a8cf712941e741dddf419200173/golang_standard/Dockerfile
