# Prefer pandas 2+ or Polars over pandas 1

## Why it matters

Tests and CI data-processing scripts use the repository's dataframe library too. Keeping pandas below version 2 prevents adopting newer performance improvements, Arrow-backed dtypes, and Copy-on-Write optimizations. Polars is another option for parallel and lazy dataframe processing.

The rule does not infer that a dataset is large or a test is slow. It identifies an old resolved version or a dependency policy that still permits pandas below 2. It does not promise that upgrading alone makes every operation faster: pandas 2's Arrow and Copy-on-Write features require appropriate configuration and workloads.

## What it flags

A Python-heavy CI workflow plus root dependency evidence resolving or permitting pandas below 2:

- `uv.lock` or `poetry.lock` resolving pandas below 2
- `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`, or `dev-requirements.txt`
- `pyproject.toml` project dependencies, optional dependencies, dependency groups, or Poetry dependency tables
- `setup.cfg` `install_requires`
- `Pipfile` packages or development packages

Supported examples include `pandas==1.5.3`, `pandas==1.*`, `pandas<2`, `pandas>=1.5`, `pandas>=1.5,<3`, Poetry `pandas = "^1.5"`, and `pandas~=1.5`.

Old uv/Poetry lockfile entries are reported even when newer versions coexist. If no old resolution is found, declarations are still checked: installing pandas 2 today does not raise a `pandas>=1.5` policy to a modern minimum. Diagnostics distinguish an old resolved version from a requirement that permits old versions.

Environment markers and conditional Poetry declarations are checked too; the rule does not assume a conditional pandas 1 dependency is intentional.

The rule does not flag:

- declarations requiring pandas 2 or newer, modern-only lockfiles without old-permitting declarations, or Polars-only projects
- comments, package descriptions, similarly named packages, and arbitrary source text
- unspecified versions, unsupported constraints, or contradictory ranges
- repositories without a Python-heavy CI signal

It emits one repository-level `warning`, including in strict mode. Dynamic `setup.py`, nested manifests, requirement includes, inline CI package overrides, and the exact runtime dependency environment are not resolved. Explicit compatibility jobs should retain their old-version coverage; suppress an intentional legacy-only finding rather than deleting that coverage.

## Suggested action

Require **pandas >=2**, upgrade old resolutions to a compatible 2.x or newer release, or migrate suitable processing to Polars. Update the dependency declaration even if a current lockfile already selects pandas 2+, and regenerate the existing lockfile as needed.

Do not simply replace dataframe types inside tests that exist to verify pandas interoperability. Preserve dtype, index, null/NaN, ordering, timezone, and mutation semantics. Polars is not a drop-in API replacement. Review Python/NumPy compatibility and pandas API removals as part of the upgrade.

## Verification

Compare fixture setup time, data-processing tests, peak memory, package installation, and total CI time. `pytest --durations=20` can help separate fixture setup from test execution. Check equivalent outputs without weakening assertions, and preserve deliberate version-matrix coverage.

## References

- [pandas 2.0 changes](https://pandas.pydata.org/docs/whatsnew/v2.0.0.html)
- [Coming from pandas to Polars](https://docs.pola.rs/user-guide/migration/pandas/)
