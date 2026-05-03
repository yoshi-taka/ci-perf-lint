# tox-without-tox-uv

## What it flags

Flags jobs that run `tox` without `tox-uv` installed.

`tox-uv` is a plugin that replaces tox's default virtual environment creation and package installation with uv's resolver and installer. It requires no configuration changes and is auto-discovered when installed alongside tox.

## Why it matters

tox's default venv creation uses the `virtualenv` package and `pip` for installation, which can be slower than uv equivalents. The `tox-uv` plugin transparently swaps these out for uv's faster implementations, speeding up tox runs with no workflow changes.

## Current heuristic

The rule looks for:

- a step that runs `tox` (e.g., `tox`, `tox run`, `python -m tox`)
- no step in the same job that installs `tox-uv` (e.g., `pip install tox-uv`)
- detection is per-job; if a job installs tox-uv before running tox, it is not flagged

The rule intentionally skips:

- jobs that already install `tox-uv` in any step
- workflows where tox is not used

## When to ignore it

Ignore this finding when:

- tox-uv is installed through a composite action or reusable workflow that the linter cannot see
- the job uses a custom tox environment that relies on pip-specific behavior
- the team has intentionally kept the pip-based workflow for consistency across environments

## Suggested verification

- Run the same tox environments with and without `tox-uv` installed
- Compare total job wall-clock time, especially for projects with many tox environments or heavy dependencies
- Verify that test output and environment behavior remain identical

## Sources

- https://github.com/tox-dev/tox-uv
- https://docs.astral.sh/uv/guides/integration/
