# Source-audit memory benchmark

Opt-in **macOS** benchmark for fresh Node processes. Not part of Tinybench,
CodSpeed or CI. No dependency installation, downloads or target lifecycle/code
execution. Requires Bun with `--no-orphans`, Node, Git, tar, ps and `/usr/bin/time -l`.

```sh
bun install --frozen-lockfile

# All SFC/config controls; compares committed trees, not uncommitted changes.
bun run bench:source-memory -- --before HEAD^ --after HEAD

# Smaller smoke run; using the same revision on both sides is supported.
bun run bench:source-memory -- --before HEAD --after HEAD \
  --runs 1 --components 6 --projects 2 \
  --cases components-mixed,config-installed,mixed-installed

# Existing real repository (never cloned or installed by the benchmark).
bun run bench:source-memory -- --before OLD_COMMIT --after NEW_COMMIT \
  --target /path/to/repository --output-dir /path/outside/the/target/results

bun run bench:source-memory -- --help
```

Default `--before HEAD^`, `--after HEAD`, three runs, 600 components, 128 projects.
Both revisions must expose either `collectSourceAudit` or the former embedded
Oxlint runner. Backend detection also supports native-vs-native comparisons.
Both are bundled with the **same currently installed host dependencies**; this is
a code comparison, not historical dependency-environment reproduction.
Historical native snapshots requiring framework compilers cannot run their
component cases with the current dependency set. Use TS/config controls or a
separately prepared historical environment; this harness never installs those compilers.

## Inputs

| Case | Purpose |
|---|---|
| `components-ts` | TS control with equivalent script/template-import facts |
| `components-vue`, `components-svelte`, `components-astro` | One component format |
| `components-mixed` | All three formats in one process |
| `config-relative` | Explicit-relative reference graph control |
| `config-local` | JSONC, extends arrays, referenced custom configs, aliases |
| `config-installed` | Same graph via a JSON-only installed-config fixture |
| `config-exports` | Agreeing conditional/array workspace exports |
| `mixed-installed` | SFCs + installed config, source audit and whole CLI |

Synthetic controls validate expected imports/snapshots/barrels, plus CLI rule
counts. Config-only controls must not warn or silently leave aliases unresolved.
The installed-config fixture includes a throwing JS `main` sentinel that must
never execute. Controls are deliberately small and regular; they are **not**
production-monorepo or exhaustive syntax/budget coverage.

`--cases A,B` selects controls. `--components N` and `--projects N` change sizes;
the latter is capped at 500 to stay inside the loader's documented budgets.
`--target` selects a supplied repository instead; it has no predetermined expected
counts, so review rule eligibility/output when interpreting results. Work and
output directories must be outside that target, including symlinked paths.

## Outputs

A new directory is created below `artifacts/source-memory/` by default (Git-ignored),
or below `--output-dir`. A separate retained temporary workspace contains archived
sources, bundles and generated inputs; `--work-dir` chooses its parent.

- `environment.json`: resolved commits, backend, runtime/dependency versions, sizes.
- `results.json`: every run's status, output summaries, peaks and validation.
- `summary.json`: medians/ranges, largest individual OS maximum and observed time.
- Per-run stdout/stderr and process/RSS traces; `setup.log` retains build receipts.

Fresh processes run **sequentially**, alternating version order. Filesystem caches
are not flushed. Do not overlap this with full tests, mutation or other benchmarks.
Raw CLI findings stay on disk rather than accumulating in the driver's heap.

## Limits and interpretation

The package command supervises the whole benchmark at 2,048 MiB / 10 minutes.
Each measured case defaults to 1,536 MiB / 30 seconds (`--memory-mib`,
`--timeout-ms`). Guarded, failed or invalid runs are recorded and stop the run,
not summarized as good performance. No unlimited allocation trials are needed.

- Tree RSS is sampled at requested 20 ms intervals; actual trace timestamps matter.
  Guardian/sampler memory is excluded; time/Node/Oxlint descendants are included.
- Short-lived children can evade command-line sampling. A completed legacy timing
  receipt confirms execution, but `shortLivedChildNotIdentified` marks the limitation.
  Do not derive precise tree-RSS percentages from such runs.
- OS individual-process maximum RSS is recorded separately. **Never sum individual
  maxima and call that the simultaneous tree peak.**
- If sampled tree RSS is below the OS individual high-water mark, the run/summary
  flags `treeSamplingLimited` / `treeUndersampledRuns`. Keep the raw value, but do
  not interpret its short-peak miss as a memory improvement.
- Limits are sampled guards, not OS hard allocation quotas.
- Legacy output/coverage is explicitly **not equivalent**. Its transport can truncate
  diagnostics at 2 MiB. Lower memory/time can mean missing work.
- SFC template provenance warnings are expected; script facts must still match.
- Observed wall time includes memory instrumentation/guard overhead: it is not an
  isolated speed benchmark, and passing counts are not a whole-program proof.

Historical measurements and raw experiments remain in `docs/internal/`; this
directory holds reusable code/methodology, not machine-specific baseline claims.

Maintainer checks:

```sh
bun run test test/boundary-source-memory-benchmark.test.ts
bun x --no-install oxlint --type-aware --type-check --deny-warnings bench/source-memory
```
