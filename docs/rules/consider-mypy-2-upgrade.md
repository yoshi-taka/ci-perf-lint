# consider-mypy-2-upgrade

Suggests planning a mypy 2.x upgrade for repositories still on mypy 1.x.

## What it detects

- `pyproject.toml`, `requirements.txt`, `setup.cfg`, `setup.py`, `poetry.lock`, or similar files pinning mypy to a 1.x (or older) version.

## Why it matters

mypy 2.0 adds parallel type checking (`--num-workers`, up to 5x with 8 workers), a native Rust parser, and fixed-format plus SQLite caches enabled by default. It is also a major release:

- `--local-partial-types` enabled by default
- `--strict-bytes` enabled by default (`bytearray`/`memoryview` no longer assignable to `bytes`)
- new `--allow-redefinition` behavior (fallback: `--allow-redefinition-old`)
- no longer supports targeting Python 3.9
- removes special casing of legacy bundled stubs

## Migration effort

Despite the major version, the migration is usually light. The main changes are default flips that surface a few new errors, and escape hatches exist (for example `--allow-redefinition-old`). Most projects need only a handful of adjustments, so the rule is reported as a `warning` with this note rather than as a blocking change.

The safe incremental 1.x ladder is handled by `prefer-mypy-performance-milestone`, and the non-breaking 2.x milestones by `prefer-mypy-2-performance-milestone`.

## Suggested action

Upgrade in a branch, run mypy, and fix or explicitly re-enable the changed defaults. Most projects need only a handful of adjustments.

## Measurement

Compare type-check times before and after upgrading, and with and without `--num-workers`.
