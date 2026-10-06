# prefer-mypy-2-performance-milestone

Detects mypy versions below known performance milestones in the 2.x series and suggests incremental upgrades within the major version.

## What it detects

- `pyproject.toml`, `requirements.txt`, `setup.cfg`, `setup.py`, `poetry.lock`, or similar files pinning mypy below a known 2.x speed milestone:
  - 2.0.x or 2.1.x → suggest 2.2
  - 2.2.x or 2.3.x → suggest 2.4

The 1.x ladder is handled by `prefer-mypy-performance-milestone`, and the jump from 1.x to 2.0 (a breaking major release) is handled by `consider-mypy-2-upgrade`.

## Why it matters

- mypy 2.2 adds internal performance improvements (memoized options snapshot, faster transitive dependency hashing for singleton SCCs, optimized TypeForm checks).
- mypy 2.4 enables the native Rust parser by default (significantly faster parsing), makes parallel type checking non-experimental with automatic worker selection (up to 5x with 8 workers), and speeds up generators and coroutines.

These are non-breaking upgrades within the 2.x series, so they are treated as `warning` rather than an advisory.

## Suggested action

Move mypy to the next 2.x milestone and validate the CI type-check job afterward.

## Measurement

Compare type-check times before and after upgrading, and with and without `--num-workers`.
