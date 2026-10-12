# Dockerfile RUN cd instead of WORKDIR

## Why it matters

Each shell-form `RUN` starts a new shell. A leading `cd` changes only that shell's directory; it does not affect later Dockerfile instructions. `WORKDIR` makes a persistent directory explicit and can avoid accidental builds in the wrong directory. It does not inherently reduce layer count or guarantee faster builds.

## What it flags

Simple shell-form `RUN cd <literal-directory> && <commands>` or standalone `RUN cd <literal-directory>` in CI build-target Dockerfiles. One exploratory-mode suggestion per Dockerfile lists affected lines and directories. Strict mode omits this advisory finding.

Subshells, pipelines, semicolon chains, conditional bodies, multiple directory changes, dynamic paths, heredocs, and JSON-form RUN are excluded. Explicit non-POSIX shells are excluded; visible shell settings are inherited across named stages.

## Suggested action

When the directory should persist:

```dockerfile
WORKDIR /usr/src/app
RUN git clone git@github.com:depot/some-repo.git
```

Review later relative `RUN`, `COPY`, `ADD`, `CMD` and `ENTRYPOINT` paths. If later instructions need the previous directory, restore its WORKDIR explicitly or retain the shell-local `cd`.

`WORKDIR` creates missing directories, whereas `cd` fails when its target is absent. Preserve an intentional existence check. Mount targets and inherited image settings also need review. No automatic fix is applied.

## Verification

Verify build outputs, working directories, failure behavior, and runtime startup. Measure performance separately rather than treating this change as an automatic speedup.

Reference: [Depot: Top 10 common Dockerfile linting issues, item 6](https://depot.dev/blog/dockerfile-linting-issues#6-make-use-of-workdir-instead-of-run-cd-some-path) (hadolint DL3003).
