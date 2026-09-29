# prefer-uv-0-12

## Why it matters

uv ships performance work continuously, and the 0.11 and 0.12 lines carried large batches that directly affect CI:

- **0.11**: a reworked resolver (IDs-only PubGrub dependencies, reused resolver work across iterations, a compact index for lazy version maps, faster candidate selection), SIMD-accelerated TOML parsing, less redundant `pyproject.toml` parsing, and bytecode compilation limited to installed distributions.
- **0.12**: faster local and cold wheel extraction (single blocking ZIP task, reused readers and buffers, positioned reads), a concurrency-safe single-download/single-extract path for wheels, batched HTTP cache writes for cold-cache resolution, background-worker Simple API parsing, faster lockfile parsing and serialization, and profile-guided optimization (PGO) builds for Linux, Windows, and macOS.

Pinning uv below 0.12 keeps CI on the slower resolver and installer, so dependency resolution and installs take longer than necessary. uv has little compatibility risk between these releases, so there is usually no reason to keep an older pin.

## What it flags

The rule reports jobs and repository configuration that resolve to a uv below 0.12:

- `astral-sh/setup-uv` steps whose `version` or `uv-version` input is below 0.12 (for example `0.11.0` or `0.11.x`).
- Shell steps that pin uv during install, such as `pip install uv==0.11.5` or `pipx install "uv<0.12"`.
- Repository configuration that constrains uv below 0.12: `required-version` in `[tool.uv]` or `uv.toml`, `uv`/`uv_build` requirement strings in `pyproject.toml`, and a `.uv-version` file.

Version constraints are read as a floor. A lower bound at or above `0.12` is accepted, and an upper bound that cannot reach `0.12` (for example `<0.12`) is flagged. `latest` and unpinned uv installs are not flagged because they already resolve to a current release.

## Suggested action

- Raise the `astral-sh/setup-uv` `version` input to at least `0.12.x`.
- Update pinned `pip`/`pipx` uv installs to `0.12.x` or newer.
- Raise `required-version` in `[tool.uv]`/`uv.toml`, the `uv`/`uv_build` requirement string, or `.uv-version` accordingly.

## Verification

Compare Python dependency resolution and install wall-clock time before and after moving uv to 0.12.x or newer, and confirm the resolved dependency set is unchanged.

## Sources

- https://github.com/astral-sh/uv/blob/main/changelogs/0.11.x.md
- https://github.com/astral-sh/uv/blob/main/changelogs/0.10.x.md
- https://github.com/astral-sh/setup-uv
