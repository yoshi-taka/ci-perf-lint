# Prefer SciPy 1.18+

## Why it matters

SciPy is used in numerical tests and fixture construction as well as production code. Performance milestones include:

- **1.14:** substantially faster sparse triangular solves and several statistics operations.
- **1.15:** structure-aware linear solves, new vectorized optimization and probability distribution APIs. New APIs require explicit adoption.
- **1.16:** lower import cost for several submodules, improved matrix square roots, image processing and statistics.
- **1.17:** faster batched linear algebra, vectorized statistical tests and sparse format conversions.
- **1.18:** compiled batching loops for QR, eigenvalue, least-squares and SVD routines, other linear algebra improvements, and reduced FFT plan-cache memory.

These are operation-specific improvements, not a guarantee that every test becomes faster. The upstream claim of over 10x for sparse triangular solves in many cases concerns that operation in 1.14, not all SciPy or whole CI runs. This project has not measured a universal SciPy CI speedup. Array API/JAX support and optional ILP64 builds are not automatically enabled by upgrading ordinary NumPy-based code.

## What it flags

A Python-heavy CI workflow plus a supported root requirement permitting SciPy below 1.18, or an old uv/Poetry resolution. This includes **0.x** (the last release was 0.19.1 in 2017) and earlier **1.x**. One repository-level `warning` is emitted, including in strict mode.

Examples: `scipy==0.19.1`, `scipy>=1.10`, `scipy==1.17.*`, `scipy<1.18`, Poetry `scipy = "^1.14"`.

Supported files:

- `uv.lock`, `poetry.lock`
- `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`, `dev-requirements.txt`
- `pyproject.toml` project dependencies, optional dependencies, dependency groups and Poetry dependency tables
- `setup.cfg` `install_requires`
- `Pipfile` packages and development packages

Conditional declarations and old entries in mixed-version locks are checked. A modern lock does not hide an old-permitting declaration. Diagnostics distinguish an old resolution from a policy permitting one.

Minimums >=1.18, comments, similarly named packages, unspecified versions, unsupported constraints and contradictory ranges are skipped. Dynamic `setup.py`, nested manifests, requirement includes and inline CI overrides are not resolved. The rule does not infer dataset size, actual slowness or the exact runtime environment.

## Suggested action

Prepare and validate an update to **scipy >=1.18**, **Python >=3.12** and **NumPy >=2.0** with compatible downstream packages/wheels. Regenerate the existing lockfile and retain intentional old-runtime/library compatibility jobs.

Resolve deprecated/removed APIs and inspect result shapes/dtypes, sparse array versus matrix semantics, batching and RNG behavior. Examples of 1.18 changes include `rankdata` output dtype, `lstsq` residuals, sparse `crosstab` results and removed solver arguments. NumPy 1-to-2 migration also requires ABI, scalar type-promotion and copy-semantics checks.

## Verification

Numerical results can change on the same CPU after algorithm or BLAS/LAPACK changes. CPU instructions and parallel reduction order may also affect rounding. Accuracy fixes may legitimately change expected values; neither bitwise equality nor arbitrarily wider tolerances is a universal upgrade policy.

- Compare known solutions, residuals, convergence, dtypes and shapes.
- Use high-precision references or mathematical invariants where appropriate.
- Justify `rtol`/`atol` from the problem's precision and conditioning.
- Separate rounding differences, accuracy fixes, intentional behavior changes and genuine regressions. Do not weaken assertions merely to pass.
- Compare imports, fixture setup, test execution, memory, installation and total CI time under comparable hardware, BLAS/LAPACK backend, thread counts and test-worker counts.

## References

- [SciPy 1.14](https://docs.scipy.org/doc/scipy/release/1.14.0-notes.html)
- [SciPy 1.15](https://docs.scipy.org/doc/scipy/release/1.15.0-notes.html)
- [SciPy 1.16](https://docs.scipy.org/doc/scipy/release/1.16.0-notes.html)
- [SciPy 1.17](https://docs.scipy.org/doc/scipy/release/1.17.0-notes.html)
- [SciPy 1.18](https://docs.scipy.org/doc/scipy/release/1.18.0-notes.html)
