# nox-without-uv-backend

## What it flags

Flags repositories and CI jobs that use nox without the `--uv` flag or `nox.options.uv = True`.

nox can delegate virtualenv creation and package installation to uv with one flag or config line, speeding up session setup significantly.

## Why it matters

nox's default backend uses `virtualenv` and `pip`, which are slower than uv equivalents. Passing `--uv` or setting `nox.options.uv = True` transparently swaps in uv, accelerating all session environment creation and dependency installation.

## Current heuristic

The rule looks for:

- a repository with nox usage (`noxfile.py` or nox references in config files)
- a CI step that runs `nox` without `--uv`
- (workflow rule only) per-job detection of nox commands missing `--uv`

The rule intentionally skips:

- nox commands that already include `--uv`
- repositories that have `nox.options.uv = True` in `noxfile.py`
- repositories without visible nox usage

## When to ignore it

Ignore this finding when:

- the project relies on pip-specific behavior that uv does not replicate
- the team has intentionally kept the pip backend for consistency
- certain nox sessions require virtualenv features that uv does not support

## Suggested verification

- Run the same nox sessions with and without `--uv`
- Compare session setup wall-clock time
- Verify that test output and environment behavior remain identical

## Sources

- https://nox.thea.codes/en/stable/config.html#opt-in-uv-backend
- https://docs.astral.sh/uv/guides/integration/
