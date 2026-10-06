# outdated-pydantic-v2

## Why it matters

Pydantic's schema build happens at import/startup time and is a long-standing V2 cost. Several v2 releases made large improvements:

- **2.9**: focused on the schema build path. `import pydantic` got about 35% faster, up to 10x faster imports in model-heavy files, faster schema building, and fewer temporary allocations.
- **2.11**: focused on schema build time and memory. Up to 2x faster schema build times and a 2-5x reduction in model schema memory. In the official Kubernetes model benchmark, startup dropped from 2.77s (2.10.6) to 1.52s (2.11.0) and final memory from 589 MB to 231 MB.
- **2.13**: focused on validation and serialization. Optimized union and tagged-union serialization, Literal validators, `LookupKey`, datetime formatting, and model-class building.

CI jobs, CLIs, and serverless startups that import many models pay this cost on every run. Staying on a v2 release below 2.13 keeps that cost higher than necessary.

## What it flags

The rule reports dependency files that constrain `pydantic` to a v2 release that cannot resolve to 2.13 or newer:

- Exact pins such as `pydantic==2.12.5`.
- Compatible-release constraints such as `pydantic~=2.12.0` or `pydantic~2.12` (which stay below 2.13).
- Explicit upper bounds below 2.13, such as `pydantic>=2.0,<2.13`.
- Resolved versions in `poetry.lock`.

It does not flag:

- Pydantic v1 constraints (see `prefer-pydantic-v2`).
- Floor-only constraints such as `pydantic>=2.0`, or caret ranges such as `pydantic = "^2.12"`, which can already resolve to 2.13+.

## Suggested action

Raise the pydantic requirement to `>=2.13` (2.13.x or newer) and refresh the lockfile.

## Verification

Compare model import, schema-build/startup time, validation/serialization throughput, and peak memory in CI before and after upgrading pydantic.

## What the scanner does

Dependency files are read as text: `pyproject.toml`, `requirements*.txt`, `setup.cfg`, `setup.py`, `Pipfile`, `Pipfile.lock`, and `poetry.lock`. Version specifiers are parsed into lower/upper bounds; a pydantic v2 requirement is flagged when its upper bound is below 2.13 (or it is pinned below 2.13). Complex or dynamic version specifiers may not be detected.

## Sources

- https://pydantic.dev/articles/pydantic-v2-9-release
- https://pydantic.dev/articles/pydantic-v2-11-release
- https://pydantic.dev/articles/pydantic-v2-13-release
