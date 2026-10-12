# Dockerfile consecutive RUN instructions

## Why it matters

Separate `RUN` instructions create separate filesystem layers. Downloading a file in one layer and deleting it in another does not remove the file from the earlier layer. Separating package index updates from installs can also reuse stale metadata.

## What it flags

Two or more consecutive `RUN` instructions in a CI build target's Dockerfile. Comments and blank lines do not interrupt a group; other instructions, including `FROM`, do. One suggestion per Dockerfile lists all affected groups.

This is an exploratory-mode suggestion, not a strict-mode warning: independent operations can intentionally have separate cache boundaries. It covers the pattern described by hadolint DL3059, without claiming every adjacent pair should be merged.

## Suggested action

Combine related download/cleanup or package update/install operations in the same `RUN`:

```dockerfile
RUN download_a_really_big_file && \
    remove_the_really_big_file
```

Preserve failure handling and shell state. Moving commands into one shell can change how `cd`, variables, and environment changes affect later commands. Review BuildKit mount options before merging. Keep stable and frequently changing operations separate when it improves cache reuse. No automatic fix is applied.

## Verification

Compare final image size and both cold and warm build times. Verify that the resulting image and command failure behavior remain correct.

Reference: [Depot: Top 10 common Dockerfile linting issues, item 1](https://depot.dev/blog/dockerfile-linting-issues#1-multiple-consecutive-run-instructions).
