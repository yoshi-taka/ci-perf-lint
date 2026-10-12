# Dockerfile apt install without version pin

## Why it matters

Without version constraints, an apt install may select different package versions when an image layer is rebuilt. Constraints can limit dependency drift and make rebuild behavior more predictable. Pinning alone does not guarantee cache hits, faster builds, or reproducibility of the entire image.

## What it flags

Literal, unpinned package arguments in `RUN apt-get install` or `RUN apt install` commands in CI build target Dockerfiles, including `ONBUILD RUN` triggers that execute when a downstream image uses this image as its base. One exploratory-mode suggestion per Dockerfile lists affected packages and original instruction lines. Strict mode does not include this advisory rule.

Exact pins (`curl=1.2.3`) and version patterns (`curl=1.2.*`) are accepted. Architecture-qualified packages (`curl:amd64`) still need a version constraint. A release selector such as `curl/bookworm` is not a version pin. Local `.deb` files, dynamic shell expressions, and option values are not treated as unpinned package names.

The explicit install suffix (`curl+`) is not a version constraint and is reported when unpinned. Removal arguments (`curl-`) are excluded.

## Suggested action

If the project's update policy requires version constraints, use available package versions:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends some-package=1.2.* && \
    rm -rf /var/lib/apt/lists/*
```

Maintain pins so security updates are not indefinitely excluded. Pins may fail when a repository removes old versions; use an appropriate snapshot or controlled repository when stronger reproducibility is required. No automatic fix is applied.

## Verification

Compare installed package versions and repeated clean-build reliability. Verify repository availability and the package update process. Measure build time separately.

## What the scanner does

Recognizes direct shell commands, simple `sudo`/`env` wrappers, apt options, and direct JSON-form commands in both `RUN` and `ONBUILD RUN`. Other `ONBUILD` instructions such as `CMD` are excluded. It does not resolve variables, parse heredoc scripts, follow shell scripts, or inspect apt preferences files. An apt preferences file may already enforce versions; review before changing installs.

Reference: [Depot: Top 10 common Dockerfile linting issues, item 2](https://depot.dev/blog/dockerfile-linting-issues#2-pin-versions-during-apt-get-install) (hadolint DL3008).
