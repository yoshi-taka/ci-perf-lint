# prefer-uv-pip-over-pip

## What it flags

Flags `pip install` commands in jobs that already have `setup-uv` available. If uv is already installed (via `astral-sh/setup-uv`), plain `pip install` should be replaced with `uv pip install` for faster installs.

## Why it matters

`uv pip install` is a drop-in replacement for `pip install`. It accepts the same arguments, reads the same requirements files, and installs into the same virtual environment. The resolver and installer are significantly faster, especially for projects with many dependencies.

When a job already sets up uv, using plain `pip install` is a missed optimization opportunity.

## Current heuristic

The rule looks for:

- jobs that use `astral-sh/setup-uv`
- a step that runs `pip install` (without the `uv` prefix)

The rule intentionally skips:

- jobs that do not use `setup-uv`
- steps that already use `uv pip install`
- steps using other package managers (poetry, pipenv, etc.)

## When to ignore it

Ignore this finding when:

- the package being installed has known incompatibilities with uv's resolver
- the script relies on pip-specific behavior that uv does not replicate

## Suggested verification

- Compare `pip install` vs `uv pip install` wall-clock time for the same package set
- Verify that the installed packages and their versions are identical

## Sources

- https://docs.astral.sh/uv/pip/
