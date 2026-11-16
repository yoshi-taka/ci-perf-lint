# Prefer Polars 2.1+

## Why it matters

Polars 2.0 makes the streaming engine the default for lazy collection and adds query optimizations and initial spill-to-disk support. Polars 2.1 adds streaming out-of-core groupby, spill-memory budgeting improvements, lower prefetch and lower-memory dataframe construction, including flat dataclasses and nested data.

Eager DataFrame operations remain in-memory. Not every query can spill or benefits from streaming; upstream SQL benchmarks are not measurements of this project's CI or universal 1.x-to-2.x speedups.

## What it flags

A Python-heavy CI workflow and a root Polars declaration permitting versions below 2.1, or an old uv/Poetry resolution. Includes 0.x, 1.x and 2.0: `polars>=1`, `polars==0.20.31`, `polars==2.0.0`, `polars>=2,<3`.

Supported files: `uv.lock`, `poetry.lock`, `pyproject.toml` (project, optional, dependency-group and Poetry declarations), `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`, `dev-requirements.txt`, `setup.cfg` install requirements, and `Pipfile`. Conditional declarations and mixed lock versions are checked. Modern locks do not hide old-permitting declarations. One `warning` is emitted, including in strict mode.

Minimums >=2.1, comments, unrelated packages, unspecified versions, unsupported constraints and contradictory ranges are skipped. Dynamic `setup.py`, nested manifests, requirement includes and CI overrides are not resolved. No dataset-size or slowness inference is made.

## Suggested action

Require **polars >=2.1**, use **Python >=3.11**, and regenerate the existing lockfile.

Follow the migration guides for the installed version. Review stricter dtype behavior, null semantics and row order after lazy joins/groupby/unpivot. Explicitly sort or use supported `maintain_order` options when order matters. Buffer round trips may require explicit `seek(0)`. Preserve compatibility jobs and test intent.

## Verification

Compare fixture construction, lazy query/test duration, peak memory, spill I/O and total CI time on representative inputs. Verify equivalent values and required ordering without weakening assertions or assuming all eager code becomes streaming.

## References

- [Polars 2.0 release](https://pola.rs/posts/release-polars-2/)
- [Polars 2.0 migration](https://docs.pola.rs/releases/upgrade/2/)
- [Polars 2.1 release](https://github.com/pola-rs/polars/releases/tag/py-2.1.0)
