# `prefer-ruff-format-over-black`

Detects repositories that appear to use `black` without visible Ruff formatting adoption.

Why this rule exists:

- Ruff can often replace a dedicated Python formatter path with a faster unified toolchain

Current MVP heuristic:

- repository-level Python tooling files such as `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `tox.ini`, or `.pre-commit-config.*` indicate `black`
- the same repository does not show visible Ruff usage in those root signals

Typical remediation:

- if repository formatting policy allows it, test `ruff format`
- keep `black` if the repository intentionally relies on its exact formatting behavior
