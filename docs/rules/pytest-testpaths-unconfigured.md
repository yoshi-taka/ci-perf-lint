# pytest testpaths is not configured

## What it detects

The project uses pytest but has not configured `testpaths` in any pytest config
file (`pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`), and CI workflow
steps do not pass explicit test paths either.

## Why it matters

Without `testpaths`, pytest traverses the entire repository directory tree to
discover test files. In a large monorepo this can add seconds or even tens of
seconds to every `pytest` invocation, slowing down both local dev and CI.

## Suggested action

Add `testpaths` to your pytest config:

```ini
# pytest.ini
[pytest]
testpaths = tests
```

Or in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
```

## How to verify

Run `pytest --collect-only` before and after the change and compare total
collection time.
