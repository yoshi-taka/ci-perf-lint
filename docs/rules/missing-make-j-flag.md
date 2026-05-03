# `missing-make-j-flag`

Detects workflow steps that run `make`, `gmake`, or `cmake --build` without any parallelization mechanism.

Why this rule exists:

- these tools default to serial execution
- runner minutes add up when a build uses only one core
- `-j$(nproc)` is a zero-risk change that cuts build wall time

What is checked:

- `run:` commands containing `make`, `gmake`, or `cmake --build`
- the command itself is checked for `-j`, `--jobs`, or `--parallel` flags
- workflow-level, job-level, and step-level `env:` maps are checked for `MAKEFLAGS` containing a `-j` flag, and for `CMAKE_BUILD_PARALLEL_LEVEL`
- for `cmake --build` only: all steps in the same job are scanned for Ninja references; if Ninja is the generator, `cmake --build` already parallelizes

Typical remediation:

- add `-j$(nproc)` to the `make` / `gmake` / `cmake --build` invocation
- or set `MAKEFLAGS: -j$(nproc)` in workflow, job, or step env
- or set `CMAKE_BUILD_PARALLEL_LEVEL: $(nproc)` for cmake-based builds
- or switch to Ninja as the CMake generator, which parallelizes by default
