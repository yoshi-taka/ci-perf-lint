# Prefer pandas 3.1+

## Why it matters

pandas 3.0 makes Copy-on-Write and dedicated string dtype the default. pandas 3.1 improves sorted-key groupby, Arrow-native reductions/casts, repeated dtype access, concat/merge and rolling. Earlier, 2.2 accelerated `testing.assert_frame_equal` and `testing.assert_series_equal`, directly relevant to CI assertions.

These are operation-specific improvements, not a guarantee that every test becomes faster. Arrow-backed strings require PyArrow.

## What it flags

A Python-heavy CI workflow and a root pandas declaration permitting versions below 3.1, or an old uv/Poetry resolution. Examples: `pandas>=2`, `pandas==2.3.3`, `pandas>=3.0`, `pandas==3.0.*`.

Legacy pandas 0.x/1.x evidence uses [prefer-pandas-v2-or-polars](prefer-pandas-v2-or-polars.md) instead, offering pandas 3.1 or Polars 2.1 without a duplicate pandas upgrade finding. If any supported source permits legacy pandas, that choice rule takes precedence.

Supported files: `uv.lock`, `poetry.lock`, `pyproject.toml` (project, optional, dependency-group and Poetry declarations), `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`, `dev-requirements.txt`, `setup.cfg` install requirements, and `Pipfile`. Conditional declarations and mixed lock versions are checked. Modern locks do not hide old-permitting declarations. One `warning` is emitted, including in strict mode.

Current minimums, comments, unrelated packages, unspecified versions, unsupported constraints and contradictory ranges are skipped. Dynamic `setup.py`, nested manifests, requirement includes and CI overrides are not resolved.

## Suggested action

Require **pandas >=3.1**, use **Python >=3.11**, check NumPy/downstream compatibility and regenerate the existing lockfile.

For 2.x migration, use 2.3 as a checkpoint if useful: resolve deprecations and test Copy-on-Write/new strings first. Replace chained assignments with `.loc`, review copy/view assumptions, read-only arrays, removed APIs and string dtype assertions. Preserve intentional compatibility jobs and test intent.

## Verification

Compare fixture setup, dataframe assertions, processing-test duration, peak memory and total CI time. Check equivalent values and intentional dtype/mutation changes without weakening assertions.

## References

- [pandas 2.2](https://pandas.pydata.org/docs/whatsnew/v2.2.0.html)
- [pandas 3.0](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html)
- [pandas 3.1](https://pandas.pydata.org/docs/whatsnew/v3.1.0.html)
