# hatch-without-uv-installer

## What it flags

Flags repositories and CI jobs that use Hatch without `installer = "uv"` configured.

Hatch can delegate package installation to uv by adding one line to its config. This speeds up environment creation with no changes to Hatch commands or workflows.

## Why it matters

Hatch's default installer uses pip + virtualenv, which is slower than uv for creating environments and installing dependencies. Setting `installer = "uv"` transparently swaps in uv's resolver and installer, speeding up all `hatch run`, `hatch shell`, and `hatch env create` operations.

## Current heuristic

The rule looks for:

- a repository with Hatch configuration (`[tool.hatch.*]` in `pyproject.toml` or `[env]` in `hatch.toml`)
- absence of `installer = "uv"` in the Hatch config
- (workflow rule only) a CI job that runs `hatch` commands

The rule intentionally skips:

- repositories that already have `installer = "uv"` configured
- jobs that do not run hatch commands
- repositories without visible Hatch usage

## When to ignore it

Ignore this finding when:

- the project relies on pip-specific installation behavior that uv does not support
- the team has intentionally kept the pip installer for consistency
- hatch is only used for building/publishing (not env management)

## Suggested verification

- Run `hatch env create` and `hatch run <command>` with and without `installer = "uv"`
- Compare environment creation and command startup time
- Verify that test output and tool behavior remain identical

## Sources

- https://hatch.pypa.io/latest/config/hatch/#env
- https://docs.astral.sh/uv/guides/integration/
