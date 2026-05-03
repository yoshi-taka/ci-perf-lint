# pdm-without-use-uv

## What it flags

Flags repositories and CI jobs that use PDM without `use_uv = true` configured.

PDM can delegate dependency resolution and installation to uv by setting one config flag. This speeds up `pdm lock`, `pdm install`, and `pdm sync` operations with no workflow changes.

## Why it matters

PDM's default backend uses pip's resolver and installer, which can be slower than uv equivalents. Setting `use_uv = true` transparently swaps in uv for both resolution and installation, accelerating the most expensive parts of PDM's workflow.

## Current heuristic

The rule looks for:

- a repository with PDM configuration (`[tool.pdm]` in `pyproject.toml` or `[pdm]` in `pdm.toml`)
- absence of `use_uv = true` in the PDM config
- (workflow rule only) a CI job that runs `pdm` commands

The rule intentionally skips:

- repositories that already have `use_uv = true` configured
- jobs that do not run pdm commands
- repositories without visible PDM usage

## When to ignore it

Ignore this finding when:

- the project relies on pip-specific behavior that uv's resolver does not support
- the team has intentionally kept the pip backend for consistency
- the `use_uv` experimental flag causes issues with specific workflows

## Suggested verification

- Run `pdm lock` and `pdm install` with and without `use_uv = true`
- Compare lock-resolution and installation wall-clock time
- Verify that the resulting lockfile and installed packages are equivalent

## Sources

- https://pdm-project.org/latest/dev/experimental/#use-uv-as-the-backend
- https://docs.astral.sh/uv/guides/integration/
