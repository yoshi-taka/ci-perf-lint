# prefer-mypy-num-workers

Detects repositories that install mypy 2.0 or newer but run it without parallel workers.

## What it detects

- mypy 2.0+ declared in dependency files (`pyproject.toml`, `requirements*.txt`, `poetry.lock`, `setup.cfg`, `setup.py`, `Pipfile`), and
- a CI command that invokes `mypy` without `--num-workers` / `-n`, and
- no parallel configuration in `mypy.ini`, `.mypy.ini`, `pyproject.toml` (`[tool.mypy]`), `setup.cfg` (`[mypy]`), or the `MYPY_NUM_WORKERS` environment variable.

## Why it matters

mypy 2.0 supports experimental parallel type checking. With `--num-workers` mypy type-checks independent module groups in separate processes and has shown up to 5x speedups with 8 workers on large projects. Parallel checking is opt-in (`num_workers` defaults to `0`, i.e. disabled), so upgrading to mypy 2.0 alone does not capture the speedup.

## Suggested action

Add `--num-workers` to the mypy command (for example `--num-workers 8` or `--num-workers auto`), or set `num_workers = auto` in the mypy configuration. Tune the worker count from 3-4 upward; using more workers than physical CPU cores is not beneficial.

## Measurement

Compare mypy wall-clock time with and without `--num-workers` on the same CI runner.
