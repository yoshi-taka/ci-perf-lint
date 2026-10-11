# dockerfile-runtime-image-uses-heavy-base

## Why it matters

Full language images and SDK images carry development tools and system packages that may not be needed to run the application. A smaller runtime image can reduce cold pulls, extraction, pushes, and storage. It does not necessarily improve application execution or cached rebuild speed.

## What it flags

The final Dockerfile stage has a visible `CMD` or `ENTRYPOINT` and uses a known development-heavy base:

- Official Node, Python, or Ruby images with a plain numeric version, `latest`, no tag, or a numeric version plus `buster`, `bullseye`, `bookworm`, or `trixie`.
- Official Go or Rust images with the same tag forms.
- Microsoft .NET SDK images with numeric versions or known Debian/Ubuntu variants.

This is a `warning`, included in strict mode, with medium confidence: runtime compatibility and actual image size require verification. Java JDK images are covered by `jvm-production-image-uses-jdk-runtime`.

When a visible Go/Rust compile output is directly executed in the same stage ancestry, `dockerfile-runtime-inherits-build-environment` supplies the more specific warning instead.

## Suggested action

Choose a lighter base appropriate to the application:

| Current base | Candidate |
|---|---|
| `node:22` | `node:22-slim` |
| `python:3.12-bookworm` | `python:3.12-bookworm-slim` |
| `ruby:3.4-trixie` | `ruby:3.4-trixie-slim`, if published for the selected version/platform |
| Go / Rust build image | Minimal OS or compatible distroless runtime; `scratch` only for verified static binaries |
| .NET SDK | Matching `runtime`, `aspnet`, or `runtime-deps`, depending on deployment type |

Keep runtime versions and OS generations where possible. `bookworm` and `trixie` describe Debian generations, not image weight. Slim retains glibc compatibility; Alpine uses musl and needs native-dependency verification. Distroless typically removes the shell and package manager. Scratch provides no OS libraries, CA certificates, or timezone data by default. Verify candidate tag/platform availability instead of mechanically rewriting tags or digests.

Keep compilers and SDKs in builder stages. Native extensions may still need compilation even when installation uses a runtime package manager.

## Verification

Compare image size and cold pull, extraction, and push times. Test startup, application behavior, native/shared libraries, certificates, timezone data, and operational requirements.

## What the scanner does

Uses CI-discovered Dockerfiles and reports once per Dockerfile, at the final `FROM`. It resolves earlier stage aliases, including chained inheritance such as `FROM builder AS prod`; switching that pattern requires a separate runtime stage with the necessary artifacts and production dependencies copied in. It skips development/test/build paths or stage aliases and visible compilation/toolchain commands in the final stage. It does not resolve variable-based image references. Already lightweight variants, custom images, unknown tags, and images outside the known families are not flagged. A digest does not suppress a known full-image tag, but digest-only references cannot identify a variant.

## Sources

- https://depot.dev/blog/optimize-your-dockerfile-for-5x-faster-builds
- https://github.com/nodejs/docker-node#image-variants
- https://github.com/GoogleContainerTools/distroless
- https://learn.microsoft.com/dotnet/core/docker/container-images
