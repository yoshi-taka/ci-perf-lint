# prefer-pydantic-v2

Detects Python dependency files that pin or request Pydantic v1.

## What it detects

- `requirements.txt`, `requirements-dev.txt`, `dev-requirements.txt`, `setup.cfg`, `setup.py`, `Pipfile`, `Pipfile.lock`, `pyproject.toml`, or `poetry.lock` containing a `pydantic` dependency with a version specifier that resolves to v1.

## Why it matters

Pydantic v2 is up to 50x faster and uses less memory than v1. The `pydantic.v1` compatibility shim lets you upgrade first and migrate code incrementally.

## Suggested action

Upgrade to Pydantic v2 and update any broken code. If you need temporary compatibility, use the `pydantic.v1` compatibility shim after upgrading:

```python
from pydantic.v1 import BaseModel
```

Then migrate incrementally to native v2 APIs.

## Measurement

Profile model validation throughput before and after migration.

## Compatibility notes

- Some legacy integrations may still require v1. In those cases, pin intentionally and suppress this rule.
- This rule uses static text matching; complex dynamic version specifiers may not be detected.
