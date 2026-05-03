# consider-slim-over-alpine-for-ci

## What it flags

Flags CI jobs that run inside a visible Alpine or musl-based container image.

## Why it matters

Alpine or musl-based containers can be a deliberate and valid choice.

However, for many CI paths they increase friction with wheels, native addons, and prebuilt binaries. That can mean extra package-manager glue, more native dependency setup, or unexpected fallbacks to source builds when a wheel or prebuilt binary would normally be available on a more common glibc-based image.

If musl compatibility is not actually required, a slim Debian-based image is often easier to maintain and may reduce package-install complexity.

## Current heuristic

The rule looks for:

- a job-level `container` image whose visible name suggests Alpine or musl
- a job that looks like real CI execution, such as lint, test, build, or other dependency-heavy work

It does not claim Alpine is wrong. It only suggests checking whether that tradeoff is intentional.

## When to ignore it

Ignore this finding when:

- musl compatibility is the point of the job
- the image choice is intentionally aligned with production or release targets
- the team has already measured this path and prefers Alpine despite the tradeoffs

## Suggested verification

- Compare total job duration between the current image and a slim Debian-based image
- Check whether package-install steps or native dependency setup become simpler
- Check install logs for signs of source-build fallback such as `building wheel`, `node-gyp`, or similar native build output
- Confirm whether the job actually needs musl coverage rather than just a small base image

## Sources

- https://docs.docker.com/dhi/core-concepts/distroless/#debian-slim-and-alpine-tags
- https://github.com/nodejs/docker-node#nodealpine
