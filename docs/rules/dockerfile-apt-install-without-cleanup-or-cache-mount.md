# dockerfile-apt-install-without-cleanup-or-cache-mount

## Why it matters

apt lists retained in an output image increase layer storage and transfer work. Deleting files in a later `RUN` does not remove them from the earlier layer. BuildKit cache mounts can preserve repeated package-manager work without baking metadata into the image.

## What it flags

Direct `apt` / `apt-get` / `aptitude update` or `install` commands without cleanup after the last package operation in the same `RUN`, or a cache/tmpfs mount covering `/var/lib/apt/lists`.

`/var/lib/apt` and broader parent cache/tmpfs mounts cover lists. Tmpfs keeps metadata out of the image without preserving it across builds. **A `/var/cache/apt` mount alone does not**: downloaded package archives and lists occupy different paths. Mount option order and `target`/`dst`/`destination` aliases are supported. Mounting only a subdirectory such as `/var/lib/apt/lists/partial` does not cover all lists.

Cleanup before package work, cleanup followed by another install/update, later-layer cleanup, unrelated mounts and quoted cleanup text do not suppress the finding. One finding per Dockerfile lists affected instructions.

`apt-get clean` removes downloaded archives, not package lists, and therefore does not suppress the finding. Removing an unrelated package manager's cache does not count as lists cleanup either.

The selected build stage and its rootfs ancestry are inspected. Independent artifact-only builders and unused stages are excluded; explicit metadata-directory copies are considered. Literal action targets, CLI `--target`, and Compose build targets are recognized. Unknown targets are not assumed to mean the last stage.

Custom apt configuration paths, `Dir::` overrides, heredocs and uncertain shell control flow are not inferred. The scanner does not execute scripts or inspect files in the base image.

## Suggested action

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
```

Alternatively, use a BuildKit cache mount covering the lists path. Mount `/var/cache/apt` separately when archive reuse matters. Preserve package selection and follow apt's locking/configuration requirements.

## Verification

Compare image layer size and cold/warm build times, including push/pull. Verify selected build targets and inherited stages. A cache mount prevents new writes from entering that layer; it does not remove lists already baked into an ancestor layer.

## References

- [Docker build best practices: apt-get](https://docs.docker.com/build/building/best-practices/#apt-get).
- [Docker cache optimization: cache mounts](https://docs.docker.com/build/cache/optimize/#use-cache-mounts).
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/).
