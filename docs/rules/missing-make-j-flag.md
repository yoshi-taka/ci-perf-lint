# `missing-make-j-flag`

Detects workflow steps that run `make`, `gmake`, or `cmake --build` without any parallelization mechanism.

Why this rule exists:

- these tools default to serial execution
- runner minutes add up when a build uses only one core
- explicit parallelism can reduce build wall time when targets and dependencies support concurrent execution

What is checked:

- `run:` commands containing `make`, `gmake`, or `cmake --build`
- each actual command is checked separately, including chained and multiline commands; echoed text, comments and heredoc bodies do not establish builds or flags
- Make's `-j`/`--jobs` and CMake's `-j`/`--parallel` are read as arguments, not substrings of filenames, targets, variable assignments or another command
- workflow, job and step `env:` are merged in that override order, then command-local assignments and visible literal exports are applied. `MAKEFLAGS` applies to Make; `CMAKE_BUILD_PARALLEL_LEVEL` applies to CMake. Empty overrides clear inherited settings. Existing explicit job-count choices are respected
- a CMake build is exempt for Ninja only when a preceding literal configure command selected Ninja or Ninja Multi-Config for the same resolved build directory in the same job; mentions in logs, unrelated directories and later configure commands do not establish this

CMake presets, Make eval expressions, command substitutions and unresolved argument lists are not treated as proven untuned commands. Simple `cd`, `-C`, workflow/job `defaults.run.working-directory`, and step `working-directory` are resolved when literal; opaque shell control flow and directory changes are not used for Makefile inspection. Help/version and Make dry-run/question/touch modes are excluded.

The same Make argument parser is used for Make commands in Vercel, Wrangler and Amplify configuration. These repository checks do not infer workflow ENV or Makefile execution context.

Makefile analysis (new):

The rule reads the default Makefile in the resolved command directory and follows a literal single-target chain
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

Custom `-f` Makefiles, multiple target selections and unresolved/out-of-repository directories do not reuse an unrelated default Makefile as parallelism evidence. Makefile options such as `-I`, `-f` and `-C` are not mistaken for target names.

Only tools actually invoked by selected recipes establish internal parallelism. Echoed tool names and unused variable definitions do not suppress the finding.

Typical remediation:

- add `-j$(nproc)` to the `make` / `gmake` / `cmake --build` invocation
- or set `MAKEFLAGS: -j$(nproc)` in workflow, job, or step env
- or set `CMAKE_BUILD_PARALLEL_LEVEL: $(nproc)` for cmake-based builds
- or switch to Ninja as the CMake generator, which parallelizes by default

Preserve command boundaries, selected targets, working directories and existing job-count constraints. Measure runtime and resource contention, and verify build correctness when tuning concurrency.
