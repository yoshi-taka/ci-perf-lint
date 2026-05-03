# avoid-mypy-production-bundle

Detects mypy declared in production dependency sections or bundled into CDK deployment assets.

## What it detects

- `mypy` listed in production dependency sections such as:
  - `[project.dependencies]` or `[project.optional-dependencies]` in `pyproject.toml`
  - `[tool.poetry.dependencies]` or `[tool.poetry.extras]` in `pyproject.toml`
  - `requirements.txt`
  - `install_requires` in `setup.py` or `setup.cfg`
  - `[packages]` in `Pipfile`
- `mypy` package files present inside CDK asset directories under `cdk.out/`

## Why it matters

mypy is a static type checker and development-only tool. Shipping it to production:

- Increases bundle and deployment package size
- Slows dependency installation in production environments
- Expands the attack surface with no runtime benefit
- Inflates Lambda cold-start latency when bundled into CDK assets

## Suggested action

Move mypy to the appropriate development dependency group:

- Poetry: `[tool.poetry.group.dev.dependencies]`
- PEP 621 / `pyproject.toml`: `[dependency-groups.dev]` or a dedicated dev extra
- Pipfile: `[dev-packages]`
- requirements: `requirements-dev.txt` or similar

For CDK assets, configure bundling to exclude dev dependencies or add mypy to the bundling exclusion list.

## Measurement

Compare the following before and after the change:

- `pip install` or `poetry install` duration in a clean environment
- CDK asset bundle size (`cdk.out/` artifact sizes)
- Lambda deployment package size

## Compatibility notes

mypy is almost never a legitimate production dependency. The only exceptions are tools that embed mypy as a library for runtime type-checking, which is extremely rare and should be explicitly reviewed.
