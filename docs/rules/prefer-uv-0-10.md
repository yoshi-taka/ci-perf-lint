# prefer-uv-0-10

## Why it matters

uv 0.10 stabilized Python version management and carried a batch of correctness and performance fixes on top of the 0.9 line. Projects and workflows that pin uv below 0.10 keep CI on the older resolver behavior, miss the stabilized `uv python` upgrade paths, and pay for issues that later releases fixed. Because `astral-sh/setup-uv` downloads the requested uv build, the pinned `version` input is the most common place an outdated uv is frozen into CI.

## What it flags

The rule reports jobs and repository configuration that resolve to a uv below 0.10:

- `astral-sh/setup-uv` steps whose `version` or `uv-version` input is below 0.10 (for example `0.9.0` or `0.9.x`).
- Shell steps that pin uv during install, such as `pip install uv==0.9.0` or `pipx install "uv<0.10"`.
- Repository configuration that constrains uv below 0.10: `required-version` in `[tool.uv]` or `uv.toml`, `uv`/`uv_build` requirement strings in `pyproject.toml`, and a `.uv-version` file.

Version constraints are read as a floor. A lower bound at or above `0.10` is accepted, and an upper bound that cannot reach `0.10` (for example `<0.10`) is flagged. `latest` and unpinned uv installs are not flagged because they already resolve to a current release.

## Suggested action

- Raise the `astral-sh/setup-uv` `version` input to at least `0.10.x`.
- Update pinned `pip`/`pipx` uv installs to `0.10.x` or newer.
- Raise `required-version` in `[tool.uv]`/`uv.toml`, the `uv`/`uv_build` requirement string, or `.uv-version` accordingly.

## Verification

Compare Python dependency resolution and install wall-clock time before and after moving uv to 0.10.x or newer, and confirm the resolved dependency set is unchanged.

## Sources

- https://github.com/astral-sh/uv/blob/main/changelogs/0.10.x.md
- https://github.com/astral-sh/setup-uv
