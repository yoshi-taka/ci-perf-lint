# prefer-setup-uv-for-lightweight-python-tooling

## What it flags

Flags jobs that:

- use `actions/setup-python`
- do not already use `astral-sh/setup-uv`
- look like lightweight Python-based tooling jobs
- are not visibly using `uv` already

This rule is intended for repository tooling such as lint, formatting, and docs checks, not for product tests or builds.

## Why it matters

For lightweight tooling-only jobs, `setup-uv` can often reduce setup and command startup overhead compared with a plain `setup-python` plus `pip`, `pipenv`, or `poetry` path.

## Current heuristic

The rule looks for:

- visible lightweight tooling commands such as `ruff`, `black`, `isort`, `flake8`, `pylint`, `bandit`, `yamllint`, `markdownlint`, or `sphinx-build`
- no visible heavier Python work such as test, typecheck, build, release, or deploy commands

The rule intentionally skips:

- jobs already using `setup-uv`
- jobs visibly using `uv`

## When to ignore it

Ignore this finding when:

- the job needs `pip`, `pipenv`, or `poetry` specific behavior
- the job also does heavier work that the heuristic cannot see
- the repository standard intentionally keeps all Python-based jobs on the same runtime setup

## Suggested verification

- Compare total job duration before and after switching to `setup-uv`
- Confirm the same tools and file targets still run successfully

## Sources

- https://docs.astral.sh/uv/guides/integration/github/
- https://github.com/astral-sh/setup-uv
