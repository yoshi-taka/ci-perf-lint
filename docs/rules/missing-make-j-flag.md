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

Makefile analysis (new):

The rule reads the Makefile in the step's working directory and follows the target chain
to detect whether the build ultimately invokes tools that already parallelize internally.
If such tools are detected, the warning is suppressed because adding `-j` at the make level
would either be useless or counterproductive (resource contention from nested parallelism).

Detected tools and patterns:

- **Go**: `go test`, `go build` (including via `$(GOTEST)`, `$(GOCMD)`, etc.)
- **Rust**: `cargo test`, `cargo build`, `cargo check`, `cargo clippy`
- **Python**: `pytest -n` (`pytest-xdist` parallel execution)
- **JavaScript/TypeScript**: `vitest`, `jest`, `turbo run`, `nx run-many`, `pnpm -r`
- **JVM**: `gradle test`/`build`/`check`, `mvn -T`, `sbt test`/`compile`

The analysis handles:

- variable definitions (`GOCMD = go`, `GOTEST = $(GOCMD) test`) with multi-pass expansion
- `include` directives (resolved one level deep)
- recursive make chains (`$(MAKE) for-all-target TARGET="test"`)
- `TARGET=name` variable passing to sub-makes

When the Makefile cannot be read or parsed, the rule falls back to the previous behavior
(emit the warning).

Typical remediation:

- add `-j$(nproc)` to the `make` / `gmake` / `cmake --build` invocation
- or set `MAKEFLAGS: -j$(nproc)` in workflow, job, or step env
- or set `CMAKE_BUILD_PARALLEL_LEVEL: $(nproc)` for cmake-based builds
- or switch to Ninja as the CMake generator, which parallelizes by default
