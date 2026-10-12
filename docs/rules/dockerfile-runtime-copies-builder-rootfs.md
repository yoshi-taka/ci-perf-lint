# dockerfile-runtime-copies-builder-rootfs

## Why it matters

`COPY --from=build / /` copies the builder's merged filesystem, including any compiler, source and build-only files still present. If the output image only needs the compiled application and runtime assets, this creates avoidable snapshot, export, push, pull and extraction work.

This is different from `FROM build`: COPY does not inherit the source stage's historical layers or its image configuration. Files already deleted from the source filesystem are not copied.

## What it flags

A literal full-root COPY from a local builder into the root of the selected output stage or its rootfs ancestry, when:

- an official Linux Go/Rust compiler base (including a named-stage descendant) directly compiles a known output using `go build -o`, `rustc -o`, or a proven default Go output;
- the output image's explicit CMD/ENTRYPOINT executes that output; and
- the compiler remains in the source filesystem, and subsequent source/output mutations do not make this evidence uncertain.

Named and numeric COPY selectors, exec-form instructions and literal action/CLI build targets are supported. Literal ENV paths, known official-image defaults such as Go's `GOPATH=/go`, and named-stage inheritance resolve WORKDIR. A literal `cp` can propagate a compiled output into the path executed by the runtime.

Default Go output inference requires a root `go.mod`, a root non-test main package, and a visible COPY supplying that module to the build WORKDIR. Only simple root-package builds are inferred. Unknown GOFLAGS/workspace/config overrides, version-suffixed module paths, library-only packages, arbitrary package targets, custom compiler bases, wrappers and opaque filesystem changes are excluded.

Unknown build targets, dynamic bases/selectors, external source images, PATH-only commands, tooling/dev/test output names or Dockerfile paths, and ambiguous relative paths are excluded. Compiler removal suppresses the finding rather than treating a cleaned rootfs as a compiler-heavy output.

The rule does not flag copying a compiler stage's selected artifacts, or transferring a runtime-only rootfs assembled in scratch. FROM inheritance is covered by the existing build/runtime separation diagnostic. Custom compiler bases, Cargo wrappers and arbitrary build scripts are outside the initial scope. One finding per Dockerfile; no automatic fix.

## Suggested action

```dockerfile
FROM golang:1.26 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

FROM scratch
COPY --from=build /out/app /out/app
ENTRYPOINT ["/out/app"]
```

Use scratch only for a verified compatible executable. Copy required shared libraries, CA certificates, timezone data, SQL migrations, configuration and other assets into an appropriate runtime base. Preserve WORKDIR, ownership, permissions and application behavior. Keep whole-root transfers when building a distro, chroot, toolchain or intentionally complete runtime rootfs. A flattening comment alone does not establish that a retained compiler is needed at runtime.

## Verification

Compare output image bytes and export, push, cold pull and extraction duration. Verify startup, dynamic linking, runtime assets and behavior. The scanner identifies a reviewable pattern; it does not prove every file outside the executable is unnecessary.

## References

- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/).
- [Docker COPY --from](https://docs.docker.com/reference/dockerfile/#copy---from).
- [Docker build best practices: choose the right base image](https://docs.docker.com/build/building/best-practices/#choose-the-right-base-image).
- [Go build output naming and flags](https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies).
- [Official Go image defaults](https://github.com/docker-library/golang/blob/master/Dockerfile-linux.template).
