# dockerfile-extracts-copied-archive

## Why it matters

Copying an archive into a layer, then extracting and deleting it in a later RUN, still stores the archive in the earlier COPY layer. A temporary extraction input can avoid that snapshot and its cache-export work. Output image bytes only decrease when the COPY layer belongs to the output stage's rootfs ancestry; artifact-only builders may only benefit in intermediate build storage/export.

## What it flags

A single local archive COPY followed by direct tar/unzip extraction, with either explicit input deletion in the extraction RUN/next substantive RUN, or proof that an independent builder exports only extracted artifacts. Supported filename families include tar, compressed tar and ZIP.

Tar extraction recognizes `-x`, `--extract` and `--get`, combined short flags such as `-xzf` or `xzf`, and separate or attached file/directory options (`-f /tmp/input.tar`, `-f/tmp/input.tar`, `-C /app`, `-C/app`). The resolved extraction input must match the copied archive's full path; matching basenames alone are not sufficient. An unrelated new stage does not inherit the copied input.

Input evidence is an existing local context file or a visible prior generation step in the same GitHub Actions/Depot job. Recognized generation includes literal tar/zip outputs and `npm pack --pack-destination` followed by a literal rename from that directory's `*.tgz`. Generated inputs are only inferred before the first visible build; conditional steps, script cwd changes, unknown output paths, later generation and visible removal invalidate that evidence. Archives supplied externally must be present when analyzing the prepared context.

The scanner resolves COPY destinations and WORKDIR, including archive renaming, literal ENV paths, standard Linux image defaults and directories visibly created by mkdir/WORKDIR. It inspects stages required by the selected output, through FROM, resolved local COPY and stage-mount dependencies. Unused stages and unknown targets are excluded.

Detection constraints:

- literal paths, a single COPY source and no COPY flags;
- literal extraction output paths; rootfs extraction into `/` is excluded;
- only recognized extraction, directory creation, archive cleanup and narrow output verification: Node script `--version`, a literal module-import check or output chmod;
- checks are preserved before cleanup, with the original archive path available; arbitrary eval bodies, external check scripts, signature/publish steps, input-overwriting redirects, shell control flow and existing RUN mounts are excluded.

Without cleanup, the source must not belong to the output rootfs ancestry or be inherited by another stage. Every consumer must copy only within the extraction output, excluding the archive itself; opaque later RUNs, full-root exports and stage mounts make retention uncertain. Cross-stage archive COPY, unresolved paths and arbitrary filesystem transformations remain outside the detector. One finding per Dockerfile lists affected archives. This is static filename/command evidence, not archive-content validation.

## Suggested action

Instead of:

```dockerfile
COPY bundle.tar.gz /tmp/
RUN mkdir -p /app && tar -xzf /tmp/bundle.tar.gz -C /app \
    && rm /tmp/bundle.tar.gz
```

Consider a temporary file input:

```dockerfile
RUN --mount=type=bind,source=bundle.tar.gz,target=/tmp/bundle.tar.gz \
    mkdir -p /app && tar -xzf /tmp/bundle.tar.gz -C /app
```

Keep extraction outputs outside the mount and preserve extraction flags and verification commands. If extraction occurs in the original archive's directory, use a separate temporary input path and adjust only the extractor's input argument. Input relocation is only suggested for pure extraction, not verification programs with potentially hidden readers. Remove only obsolete deletion of the mounted archive; do not try to unlink a bind-mounted input during that RUN. Verify check behavior, target-placeholder and later filesystem behavior.

Local tar ADD extraction is also possible when the semantics match. **ADD does not auto-extract ZIP files**, and tar options such as `--strip-components` or custom ownership/path handling may differ from ADD. No automatic rewrite is applied.

## Verification

Compare intermediate snapshots, cache export bytes/time and cold/warm build time, plus output image bytes where relevant. Check extracted content, ownership, permissions and downstream consumers. The archive still needs to reach the build context, and decompression still happens: do not assume reduced context transfer or decompression CPU.

## References

- [Docker bind mounts for temporary build inputs](https://docs.docker.com/build/cache/optimize/#use-bind-mounts).
- [Docker RUN --mount=type=bind](https://docs.docker.com/reference/dockerfile/#run---mounttypebind).
- [Docker ADD: local archive extraction](https://docs.docker.com/reference/dockerfile/#adding-local-tar-archives).
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/).
- [npm pack and pack destination](https://docs.npmjs.com/cli/commands/npm-pack/).
