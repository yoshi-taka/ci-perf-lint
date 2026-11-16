# Prefer pandas 3.1+ or Polars 2.1+ over legacy pandas

## Why it matters

Tests and CI data-processing scripts use the repository's dataframe library too. pandas 2.2 accelerated dataframe/series equality assertions; 3.0 made Copy-on-Write and dedicated string dtype the default; 3.1 improves groupby, Arrow reductions/casts, concat/merge and rolling. Polars 2.1 is an alternative with parallel lazy execution, streaming out-of-core groupby and improved memory management.

The rule does not infer that a dataset is large or a test is slow. It identifies an old resolved version or a dependency policy that still permits pandas below 2, including 0.x. It recommends choosing pandas >=3.1 or Polars >=2.1, not stopping at pandas 2. Both targets require Python >=3.11. Arrow-backed pandas strings require PyArrow; eager Polars operations remain in-memory. No uniform speedup is promised.

The historical rule ID remains `prefer-pandas-v2-or-polars` for existing suppressions. pandas 2.x/3.0 baselines are handled by [prefer-pandas-3-1](prefer-pandas-3-1.md); existing Polars dependencies by [prefer-polars-2-1](prefer-polars-2-1.md).

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

Choose **pandas >=3.1** or migrate suitable processing to **Polars >=2.1**. Update Python to >=3.11, raise the dependency minimum even if a current lockfile already selects a newer version, and regenerate the existing lockfile.

Do not simply replace dataframe types inside tests that exist to verify pandas interoperability. Preserve dtype, index, null/NaN, ordering, timezone, and mutation semantics. Polars is not a drop-in API replacement. Review Python/NumPy compatibility and pandas API removals as part of the upgrade.

For pandas, 2.3 can be an intermediate migration checkpoint: resolve warnings and test Copy-on-Write/new strings before moving to 3.1. Replace chained assignments with `.loc` and review read-only arrays. For Polars, review lazy result ordering and explicitly sort or use supported `maintain_order` options. Retain intentional legacy compatibility jobs.

## Verification

Compare fixture setup time, data-processing tests, peak memory, package installation, and total CI time. `pytest --durations=20` can help separate fixture setup from test execution. Check equivalent outputs without weakening assertions, and preserve deliberate version-matrix coverage.

## References

- [pandas 2.0 changes](https://pandas.pydata.org/docs/whatsnew/v2.0.0.html)
- [Coming from pandas to Polars](https://docs.pola.rs/user-guide/migration/pandas/)
- [pandas 2.2 changes](https://pandas.pydata.org/docs/whatsnew/v2.2.0.html)
- [pandas 3.0 changes](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html)
- [pandas 3.1 changes](https://pandas.pydata.org/docs/whatsnew/v3.1.0.html)
- [Polars 2.1 release](https://github.com/pola-rs/polars/releases/tag/py-2.1.0)
