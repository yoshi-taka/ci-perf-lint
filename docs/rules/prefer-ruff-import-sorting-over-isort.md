# `prefer-ruff-import-sorting-over-isort`

Detects repositories that appear to use `isort` without visible Ruff import-sorting adoption.

Why this rule exists:

- Ruff can often cover import sorting in the same toolchain used for other Python checks

Current MVP heuristic:

- repository-level Python tooling files such as `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `tox.ini`, or `.pre-commit-config.*` indicate `isort`
- the same repository does not show visible Ruff usage in those root signals

Typical remediation:

- if repository lint policy allows it, test `ruff check --select I`
- keep `isort` if the repository intentionally relies on separate tooling behavior
