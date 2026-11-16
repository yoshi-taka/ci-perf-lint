# Prefer NumPy 2.5+

## Why it matters

Numerical tests and fixture construction use the repository's NumPy dependency too. NumPy 2.5 adds fast paths for reductions such as `sum`, `prod`, `any` and `all` on small/medium contiguous, aligned, non-object arrays, when reducing all axes without special arguments. It also improves `searchsorted` for multiple search keys.

Earlier milestones include sorting, strings and macOS Accelerate support in 2.0; hash-based `unique` for supported dtypes and ARM float16 casts in 2.3; and scalar unary operations, `ndindex` and more `unique` dtypes in 2.4.

Upstream reports about 1.3x for typical small-array reductions, up to 1.9x for contiguous boolean `any`/`all`, and up to 20x for `searchsorted` with hundreds of thousands of keys. These are conditional upstream measurements, **not this project's CI measurements or promised whole-suite speedups**.

Free-threaded scaling improvements require a free-threaded Python build. The parallel sorting feature introduced in 2.3 requires an OpenMP-enabled NumPy build; upgrading a standard wheel alone does not enable it.

## What it flags

A Python-heavy CI workflow plus a supported root declaration permitting NumPy below 2.5, or a uv/Poetry resolution below 2.5. It emits one repository-level `warning`, including in strict mode.

Supported examples include `numpy==1.26.4`, `numpy>=1.24`, `numpy<2`, `numpy==2.4.*`, `numpy>=2,<3`, and Poetry `numpy = "^2.0"`.

Supported files:

- `uv.lock` and `poetry.lock`
- `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`, `dev-requirements.txt`
- `pyproject.toml` project dependencies, optional dependencies, dependency groups and Poetry dependency tables
- `setup.cfg` `install_requires`
- `Pipfile` packages and development packages

Conditional declarations are checked. Mixed lockfiles still report an old entry, and a current lock does not hide an old-permitting requirement. Diagnostics distinguish a resolved old version from a policy that permits one.

It skips current minimums such as `numpy>=2.5`, comments, similarly named packages, unspecified versions, unsupported constraints and contradictory ranges. Dynamic `setup.py`, nested manifests, requirement includes, CI overrides and the exact runtime environment are not resolved. It does not infer dataset size or that a test is slow.

## Suggested action

Require **numpy >=2.5**, use **Python >=3.12**, update old resolutions and regenerate the existing lockfile. Check downstream dependencies such as pandas and SciPy for compatible releases and wheels.

When upgrading from 1.x, review:

- NumPy 2's ABI break: update compiled dependencies and rebuild local extensions as needed.
- Removed APIs: Ruff `NPY201` can automate supported migrations, not every behavior change.
- Scalar type promotion, dtype and precision changes, overflow, and the Windows default integer width.
- `copy=False` requirements and copy/view assumptions.
- Incidental ordering from unstable sorts, numerical tolerances and later 2.x API removals.

Preserve intentional old-runtime/NumPy compatibility jobs. Review changed expectations without weakening test assertions.

NumPy remains a foundation for many libraries. JAX, CuPy and PyTorch are workload-specific alternatives, not automatic upgrade destinations. Numba complements NumPy rather than replacing it. A separate migration requires actual workload/environment evidence and measurements including JIT warmup, device transfers and accelerator startup.

## Verification

Compare fixture construction, numerical tests, peak memory, installation and total CI time. Hold BLAS thread settings and test-worker counts comparable so nested parallelism does not distort results. Verify equivalent results with appropriate tolerances, dtypes and explicit ordering.

## References

- [NumPy 2.0](https://numpy.org/doc/2.0/release/2.0.0-notes.html)
- [NumPy 2.3](https://numpy.org/doc/2.3/release/2.3.0-notes.html)
- [NumPy 2.4](https://numpy.org/doc/2.4/release/2.4.0-notes.html)
- [NumPy 2.5](https://numpy.org/doc/2.5/release/2.5.0-notes.html)
- [NumPy 2 migration](https://numpy.org/doc/stable/numpy_2_0_migration_guide.html)
