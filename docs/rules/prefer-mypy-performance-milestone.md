# prefer-mypy-performance-milestone

Detects mypy versions below known performance milestones in the 1.x series and suggests incremental upgrades.

## What it detects

- `pyproject.toml`, `requirements.txt`, `setup.cfg`, `setup.py`, `poetry.lock`, or similar files pinning mypy to a 1.x version below a known speed milestone:
  - below 1.13 → suggest 1.13
  - below 1.15 → suggest 1.15
  - 1.18.0 or earlier → suggest 1.18.1

## Why it matters

Each milestone release includes measurable type-checking speed improvements. Upgrading incrementally reduces risk while still delivering faster CI runs.

## Suggested action

Bump mypy to the next milestone version, run the type-checker, and fix any new errors before targeting the next milestone.

## Measurement

Compare `mypy` runtime before and after the upgrade.
