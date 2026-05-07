# pytest-xdist-installed-but-not-used

Detects CI pytest commands that run without parallel workers despite `pytest-xdist` being installed.

## Why it matters

`pytest-xdist` can significantly reduce wall-clock time for large test suites by distributing tests across CPU cores. Since the project already includes `pytest-xdist` as a dependency, parallel execution was likely intended but not enabled in CI.

## Detection

Reports when **all** of the following are true:

- CI command runs `pytest` directly (not via tox/nox/make)
- `pytest-xdist` is installed in project dependencies
- pytest command does not use `-n` or `--numprocesses`
- pytest config does not enable xdist via `addopts`
- Test suite appears non-trivial (30+ test files in a test directory)

## Exclusions

Does **not** report when:

- `-n` / `--numprocesses` is present in the command
- pytest config already sets `addopts = -n auto`
- Command targets a single test file
- Command uses serial-only flags (`--pdb`, `--trace`, `--forked`, `-s`, `--capture=no`)
- Command targets integration/e2e/smoke markers (`-m integration`, etc.)
- Command runs via a wrapper (tox, nox, make test, npm test, just test)

## Severity

`warning` — the project already opted into `pytest-xdist` but is not using it in CI.
