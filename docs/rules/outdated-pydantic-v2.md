# outdated-pydantic-v2

## Why it matters

Pydantic's schema build happens at import/startup time and is a long-standing V2 cost. Two v2 releases made large improvements:

- **2.9**: focused on the schema build path. `import pydantic` got about 35% faster, up to 10x faster imports in model-heavy files, faster schema building, and fewer temporary allocations.
- **2.11**: focused on schema build time and memory. Up to 2x faster schema build times and a 2-5x reduction in model schema memory. In the official Kubernetes model benchmark, startup dropped from 2.77s (2.10.6) to 1.52s (2.11.0) and final memory from 589 MB to 231 MB.

CI jobs, CLIs, and serverless startups that import many models pay this cost on every run. Staying on a v2 release below 2.11 keeps that cost higher than necessary.

## What it flags

The rule reports dependency files that constrain `pydantic` to a v2 release that cannot resolve to 2.11 or newer:

- Exact pins such as `pydantic==2.10.6`.
- Compatible-release constraints such as `pydantic~=2.10.0` or `pydantic~2.10` (which stay below 2.11).
- Explicit upper bounds below 2.11, such as `pydantic>=2.0,<2.11`.
- Resolved versions in `poetry.lock`.

It does not flag:

- Pydantic v1 constraints (see `prefer-pydantic-v2`).
- Floor-only constraints such as `pydantic>=2.0`, or caret ranges such as `pydantic = "^2.10"`, which can already resolve to 2.11+.

## Suggested action

Raise the pydantic requirement to `>=2.11` (2.11.x or newer) and refresh the lockfile.

## Verification

Compare model import, schema-build/startup time, and peak memory in CI before and after upgrading pydantic.

## What the scanner does

Dependency files are read as text: `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `setup.py`, `Pipfile`, `Pipfile.lock`, and `poetry.lock`. Version specifiers are parsed into lower/upper bounds; a pydantic v2 requirement is flagged when its upper bound is below 2.11 (or it is pinned below 2.11). Complex or dynamic version specifiers may not be detected.

## Sources

- https://pydantic.dev/articles/pydantic-v2-9-release
- https://pydantic.dev/articles/pydantic-v2-11-release
