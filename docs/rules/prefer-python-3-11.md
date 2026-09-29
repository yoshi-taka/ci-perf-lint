# prefer-python-3-11

## Why it matters

Python 3.11 is the "Faster CPython" milestone. Compared with 3.10 it is 10-60% faster (about 1.25x on the pyperformance suite), and interpreter startup is 10-15% faster. Both directly shorten Python CI jobs, and short-running scripts benefit most from the startup win. Python 3.12 and 3.13 continue the work.

There is also a lifecycle reason: Python 3.10 reaches end-of-life in October 2026, and 3.9 / 3.8 are already end-of-life. End-of-life runtimes stop receiving security fixes.

## What it flags

The rule reports CI and repository configuration that pins Python below 3.11:

- `actions/setup-python` steps whose `python-version` input is below 3.11 (for example `3.9`, `3.10`).
- `strategy.matrix.python-version` values (including `include` entries) below 3.11.
- Repository declarations: `.python-version`, `runtime.txt`, `tox.ini` `basepython`, and `requires-python` / `python_requires` that cannot resolve to 3.11+ (exact pins or upper bounds below 3.11).

It does not flag a floor-only `requires-python` such as `>=3.9`, because that can already install on 3.11 or newer.

## Suggested action

Move CI to Python 3.11 or newer and update the declarations together:

- `actions/setup-python` `python-version` input and matrix entries
- `.python-version`
- `tox.ini` / `noxfile.py` `basepython`
- `requires-python` / `python_requires`

If a pinned dependency blocks 3.11+, upgrade that dependency first; only suppress this rule with a documented rationale.

## Verification

Compare Python job wall-clock time, import/startup time, and test duration before and after moving the runtime to 3.11 or newer.

## What the scanner does

Workflow steps and job matrices are read from the GitHub Actions document. Repository version declarations are collected into a `python.versionOccurrences` signal from `.python-version`, `runtime.txt`, `tox.ini`, `pyproject.toml`, and `setup.cfg`. Version specifiers are parsed as lower/upper bounds; a declaration is flagged when it forces an effective version below 3.11.

## Sources

- https://docs.python.org/3/whatsnew/3.11.html
- https://devguide.python.org/versions/
