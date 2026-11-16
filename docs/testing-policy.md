# Testing Policy

## Testing approaches overview

| Approach | Files | Purpose |
|---|---|---|
| **Boundary / unit** | `test/boundary-*.test.ts` | BVA/EP on individual functions |
| **Integration (fixture)** | `test/analyze-repository-*.test.ts` | End-to-end with mini-repo fixtures |
| **CLI surface** | `test/cli.test.ts` | Argument parsing, exit codes, flags |
| **Golden regression** | `test/golden.test.ts` | Snapshot JSON output comparison |
| **Cross-platform invariance** | `test/cross-platform-invariance.test.ts` | Same rule fires identically across CI types |
| **Property-based** | `test/fuzz-*.test.ts` | Random input invariant testing (fast-check) |
| **Pairwise / combinatorial** | `test/pairwise-cluster-*.test.ts` | All-pairs interaction coverage across rule clusters |
| **Reporter rendering** | `test/reporters-render-report.test.ts` | Text / JSON / markdown / handoff output format |
| **Reporter aggregation** | `test/reporters-aggregation*.test.ts` | Grouped findings, deduplication, preservation of distinct fixes |
| **Metamorphic / differential** | `test/boundary-metamorphic.test.ts` | Oracle-less invariant verification |
| **Mutation** | `stryker/stryker.*.config.mjs` | Local mutation runner (opt-in, slow) |

## Lean and Z3: what they add

Tests check examples. Lean and Z3 also help check the logic behind selected parts
of the tool. Neither replaces tests or proves that the whole application is correct.

### Lean: prove properties of a model

Lean checks mathematical models of evidence thresholds, gate evaluation/pruning,
and finding retention. Separate scripts compare model results with the real
TypeScript functions on generated inputs.

This proves properties of the **model**, not complete equivalence with TypeScript.
The comparisons help catch differences between the model and implementation, but
cover only the tested inputs. Model assumptions and exclusions must stay explicit.

Run `bun run verify:formal` with the required Lean toolchain installed. Ordinary
tests do not require Lean. Setup, scope, and limitations: [formal/README.md](../formal/README.md).
If the toolchain is unavailable, report the verification as not run, not passed.

### Z3: look for counterexamples

Z3 has been used in an exploratory PoC to ask: "Can these conditions make a fix
disappear from the grouped report?" It found a counterexample in a manually written
model. A real workflow then reproduced the problem: pnpm and Bun fixes were combined,
leaving only one instruction in `fixFirst`. Both instructions now remain, guarded by
[`reporters-aggregation-remediation.test.ts`](../test/reporters-aggregation-remediation.test.ts).

Z3 is **not** a runtime dependency or a permanent CI check. A model counterexample
is a candidate bug: reproduce it in the real code and check the intended behavior
before calling it a defect. "No counterexample" means only none within the modeled
conditions, not that the entire codebase is bug-free.

Native source-audit verification uses Bun + the official `z3-solver` WASM bindings,
with an isolated optional manifest/lock under `formal/`; no Python is needed.
Run `bun install --cwd formal --frozen-lockfile`, then
`bun run --cwd formal verify:source`. See the scope in `formal/README.md`.

For either tool: state the property and assumptions, replay counterexamples against
the implementation, and turn confirmed defects into ordinary regression tests.

## Goals

- Keep tests easy to scan when adding new rules.
- Keep fixture ownership obvious.
- Avoid turning one file into the default dump site for every regression test.

## File split policy

- Put `analyzeRepository()` behavior tests under `test/analyze-repository-*.test.ts`.
- Put focused boundary and regression tests under `test/boundary-*.test.ts`.
- Put output rendering tests in `test/reporters-render-report.test.ts` and `test/reporters-aggregation.test.ts`.
- Put CLI surface tests in `test/cli.test.ts`.
- Keep shared fixture path definitions in `test/fixtures.ts`.
- Keep shared test utilities in `test/helpers.ts`.

## When adding a new test

- If the assertion is about findings, rule IDs, severity, or false positives, add it to an `analyze-repository-*` file.
- If the assertion is about handoff, text, JSON, or markdown output, add it to `test/reporters-render-report.test.ts`.
- If the assertion is about grouped findings or deduplication, add it to `test/reporters-aggregation.test.ts`.
- If the assertion is about argument parsing, exit codes, or `--show-workflows`, add it to `test/cli.test.ts`.

## How to split analyze tests

- Group tests by behavior area, not by chronology.
- Prefer categories such as:
  - workflow gating and release safety
  - cache and runtime cost
  - language and repo-aware tooling
- If an `analyze-repository-*` file grows past roughly 300 to 400 lines, split it again by category.

## Fixture policy

- Reuse an existing fixture when the scenario is the same and only the assertion changes.
- Add a new fixture when the repository shape is materially different.
- Keep fixtures minimal and purpose-built for the rule or regression being tested.

## Fixture naming

- Use `*-like` for fixtures that are expected to trigger at least one finding.
- Use `*-ok` for fixtures that are expected not to trigger the targeted finding.
- Use a stable scenario prefix tied to the rule or behavior under test, for example:
  - `docker-build-context-like`
  - `docker-build-context-ok`
  - `lodash-es-root-import-like`
  - `nx-cache-like`
  - `nx-cache-ok`
- Keep the name focused on the scenario the fixture proves, not on the test file that happens to use it.
- Prefer one narrow fixture per behavior family over a large realistic fixture with unrelated signals.
- When one fixture is intentionally broader or reused across multiple assertions, keep the name scenario-based and explain the broader role in the test body instead of encoding extra detail into the fixture name.

## Fixture expectations

- A `*-like` fixture should usually map to one primary finding family, even if adjacent findings are also expected.
- A `*-ok` fixture should prove the absence of the targeted finding by making the safe or optimized pattern visible in the fixture itself.
- If a fixture needs to model an exception case rather than a positive or clean baseline, prefer a descriptive suffix that still preserves the scenario stem, for example `deep-checkout-mutating-action` or `clean-no-findings`.
- Before adding a new fixture, check whether an existing `*-like` or `*-ok` fixture already expresses the same repository shape closely enough.

## CI YAML aliases and merges

`src/ci-yaml.ts` separates CI dialect policy from the generic YAML parser.
GitHub Actions/Depot resolve aliases without map merges; CircleCI, GitLab CI,
and Buildkite resolve aliases and map merges. Discovery and document extraction
must use the same resolved AST, retaining definition-site source ranges.
This is not full CI schema validation or implementation of GitLab `extends`/`!reference`.

Tests must assert an inherited command reaches an actual registered rule, not
just that parsing succeeds. Check explicit overrides before/after merges,
multiple-source precedence, declaration-order alias binding, normal duplicate
rejection, cycles, logical expansion/depth/work limits, and source locations.
See `test/boundary-ci-yaml-references.test.ts` and
`test/analyze-repository-yaml-inheritance.test.ts`.
The fixture validity guard checks both independent YAML syntax and CI policy.

Merge semantics references: [GitLab anchors](https://docs.gitlab.com/ci/yaml/yaml_optimization/#anchors),
[Buildkite anchors/overrides](https://buildkite.com/docs/pipelines/integrations/plugins/using#overriding-yaml-anchors).

## Guard rule-specific absence assertions

Use `analyzeRepositoryForRule(options, { id, severity })` from `test/helpers.ts` when a fixture is intended to exercise one rule's command/configuration behavior. It rejects suggestion tests outside exploratory mode and target-rule `gate-skipped`, `rule-error` or `collector-error` telemetry, so an empty result cannot silently pass for those reasons. Existing report callers can use `assertRuleTestReport(report, rule, mode)`.

This guard does not prove that every detector or config signal matched. Keep a positive baseline in the same behavior family; for config scope, include a case where the applicable config actually suppresses the finding. Tests intentionally exercising gate skips, mode filtering, or rule failures should use `analyzeRepository()` directly and assert the expected telemetry/output.

```ts
const report = await analyzeRepositoryForRule(
  { cwd, targetPath: ".", topCount: 100, mode: "exploratory" },
  { id: "prefer-cdk-asset-build-concurrency", severity: "suggestion" },
);
```

## Anti-patterns

- Do not add new tests back into a single catch-all `main.test.ts`.
- Do not create one test file per rule unless the rule needs substantial dedicated setup.
- Do not duplicate large fixture path lists across multiple test files.

## Property-Based Testing (fast-check)

- Property-based testing generates random inputs and checks invariants (properties)
  instead of hardcoded expected outputs.
- Framework: `fast-check`. Files: `test/fuzz-*.test.ts`.
- Key domains:

| Domain | File | Property asserted |
|---|---|---|
| **CLI parsing** | `test/fuzz-cli-args.test.ts` | `parseArgs` either returns valid options or throws typed errors; never crashes |
| **Workflow parsing** | `test/fuzz-parse-workflow.test.ts` | YAML parser returns valid workflow structure or throws; never crashes |
| **Cross-platform parsing** | `test/fuzz-cross-platform-parsers.test.ts` | Buildkite / CircleCI / GitLab CI parsers survive random input |
| **Rule evaluation** | `test/fuzz-evaluate-rules.test.ts` | `evaluateRules` returns `Diagnostic[]` for any valid workflow; never throws |
| **Render invariants** | `test/fuzz-diagnostics-and-render.test.ts` | Render output is deterministic and survives round-trip |

### When to add a property-based test

- The function has a clear invariant that holds for all valid inputs.
- Edge cases are too numerous to enumerate manually.
- The input space is easily generated by `fast-check` arbitraries.

### Adding a new property test

- Add one `test/fuzz-{domain}.test.ts` file.
- For complex input structures, add arbitraries under `test/arbitraries/`.
- Keep properties simple (one invariant per `fc.property` call).
- Set `numRuns` and `interruptAfterTimeLimit` to keep CI-friendly.

### Coverage-guided fuzzing (jazzer.js)

- `jazzer.js` for isolated coverage-guided targets: `fuzz/*.fuzz.mjs`.
- Kept out of default `bun test` path.
- Build targets: `bun run build:fuzz-targets`.
- Run: `bun run test:fuzz:jazzer -max_total_time=2`.

## Pairwise / Combinatorial Testing

- Use pairwise (all-pairs) for rule interaction clusters where full Cartesian space is large
  but 2-way interactions between parameters are the primary risk.
- Each cluster tests a set of rules that share overlapping signals (trigger, runner OS,
  checkout depth, cache strategy, etc.).
- Test file: `test/pairwise-cluster-{id}.test.ts`.
- Combinator: `test/pairwise-utils.ts` exports `generatePairwise(specs)` using an
  In-Parameter-Order (IPO) greedy algorithm.

### When to add a pairwise test

- The full combinatorial space exceeds ~50 cases.
- Multiple rules inspect overlapping workflow features with different skip conditions.
- The interaction between parameters is non-trivial (rule A skips on signal X, rule B
  fires on signal X but skips when Y is also present).

### Structure

```
paramsDef → ParamSpec[] → generatePairwise() → combinations[]
                                                      ↓
                                              test.each(combinations)
                                                      ↓
                                          generateWorkflowYAML(params)
                                          setupFixture() → analyzeRepository()
                                          expectedClusterXRules(params) ↔ findings
```

### Guidelines

- Each test case generates a workflow YAML from parameters, writes it to a temp
  directory, runs `analyzeRepository`, and compares findings against a pure-function
  expected-rules oracle.
- The oracle (`expectedClusterXRules`) mirrors rule source logic. Discrepancies
  between oracle and actual findings indicate either a bug in rules or incomplete
  parameter modeling.
- Keep parameters focused on the cluster's signals. Use `test/pairwise-utils.ts`
  for the combinator; do not duplicate it per file.
- Prefer `mode: "exploratory"` when testing `suggestion`-severity rules.
- Assert no crash + expected rule IDs present + no unexpected cluster rule IDs.
- Do not assert total finding count (other clusters' rules may fire incidentally).

## Mutation Testing (local runner)

- Mutation testing uses `src/mutation/` for targeted source files where correctness is critical.
- Configs remain `stryker/stryker.*.config.mjs` (Stryker-compatible shape); each config's `mutate` list is the coverage boundary, not every rule in the repository.
- Run: `bun run test:slow:mutation` (not in default `bun test` path; intentionally slow).
- Scripts pass `--sandbox`, so the working tree is never rewritten. The sandbox copies `src`, `test`, `scripts`, `docs`, `package.json`, `bun.lock`, `bunfig.toml` and `tsconfig.json`, symlinks `node_modules` and `.fixture-cache`, and skips the `test/setup.ts` preload (about 40ms per mutant) because Bun isolates test files by default.
- Each mutant gets its own `TMPDIR` under the sandbox, removed in `finally` even for timeouts. The runner itself is killed only by SIGKILL; the next run removes a stale sandbox root.
- `--jobs` defaults to 2; set `MUTATION_JOBS` or pass `--jobs=N` to change it. Parallel workers use separate sandboxes and share the fixture cache. `--list` prints mutants without running tests.
- Targets include core helpers, workflow/rule-engine paths, repository finding utilities, reporter paths, source audit/resolution, and a separate shell-evidence target. Inspect the config rather than assuming a whole directory is mutated.
- Add a new config file when adding a new module whose mutation coverage should be tracked.
- Known divergence from the former Stryker filter: two empty-expression mutants in `source-audit` are suppressed locally because nested arrow/object mutants count as being in scope (one was Killed, one Survived upstream).
- `.github/workflows/mutation-smoke.yml` runs core then shell-evidence smoke steps in one job weekly and on manual dispatch, sharing checkout and dependency setup. The ordinary PR test job runs the input-transformation tests, not the slow mutation run.
- Mutation testing changes **implementation** to check test strength; it does not automatically supply **input** transformations such as adding an echo. Both are needed.

## Metamorphic / Differential Testing

- Metamorphic relations (oracle-less differential testing) verify invariants that should
  hold across semantically equivalent transformations.
- File: `test/boundary-metamorphic.test.ts`.
- Verified relations:

| Relation | What it tests |
|---|---|
| **Partition completeness** | `workflow-only` + `repository-only` findings partition matches full-report findings |
| **YAML presentation invariance** | Comments, blank lines, key reordering do not change findings |
| **Aggregation commutativity** | Aggregated findings are independent of input finding order |
| **Render encapsulation** | `findingsOnly` output depends only on `report.findings`, not on other `ReportData` fields |
| **JSON semantic stability** | JSON output is semantically equivalent across different render options after normalization |

### When to add a metamorphic test

- The behavior has a clear invariant that should hold under transformation, reordering,
  or reformatting.
- No oracle exists (you cannot list every expected finding), but a relational property
  between two outputs is provable (e.g., A ∪ B = C).
- The property would break if a regression introduces non-determinism or coupling to
  irrelevant input.

### Guidelines

- Prefer comparisons of normalized structures over raw string equality.
- Use `toEqual` for structural equality after normalization.
- Keep general pipeline relations in `test/boundary-metamorphic.test.ts`. Shell-evidence relations have the dedicated suite below; do not grow the general file into a rule-regression catch-all.
- Avoid re-testing individual rule logic. Metamorphic tests target cross-cutting
  pipeline invariants (partitioning, ordering, rendering), not rule correctness.

### Shell evidence: commands are not printed examples

These three inputs are not equivalent executions:

```sh
npm install          # executes
echo 'npm install'   # only prints
# npm install        # only comments
```

Use `test/shell-evidence-metamorphic.ts` and register a minimal scenario in
`test/analyze-repository-shell-evidence-metamorphic.test.ts` when adding or changing
command evidence, skip/exemption logic, or repository collectors driven by commands.

The shared contract automatically checks:

1. **A positive baseline really fires.** Declare explicit counts per rule/scope. An always-empty detector must fail the test.
2. **Harmless logs do not change diagnostics.** Prepend and append generated echo, printf, and shell-comment variants of install/build/meta/history/builder-state text. Compare finding identity, severity, confidence, score, explanation, and suggestion. Line/column offsets are ignored. Only source-quoting messages may opt out of message equality with `messageIncludesSource`; other fields remain checked.
3. **Printed commands do not become execution.** Replace the selected executable text with generated single-quoted echo/printf or comments. Declare `literalCount` for each affected rule/scope; it is not automatically zero. Real action/configuration evidence may still justify a finding.
4. **Actual substitutions stay executable.** Set `executableSubstitution` when that rule models it. Double quotes do not make `$(...)` or backticks harmless. Keep separate conservative guard tests where substitutions make execution unknown, such as job-wide runner portability.
5. **A failed/skipped analysis is not a passing negative control.** Parser/rule/collector failures, target gate skips, and truncation fail the contract. Suggestions always use exploratory mode.

The command is `bun run test:shell-evidence`. The test files are also included in
the normal `bun run test`, so PR CI enforces the contract without a separate opt-in.
Initial scenarios cover runner safety/severity, meta/timeout gates, sparse scope,
Elixir, CDK, container installs, persistent Docker targets, mise/tox collectors, and
ESLint/tsc package scripts. This is a growing registry, not proof that every rule or
CI dialect has exhaustive coverage. Keep existing focused and cross-platform tests.

Do **not** label all echo/printf statements harmless: a recognized write to
`$GITHUB_ENV` has an effect and needs its own positive control. Structured checkout,
agent/build actions, configuration files, and meaningful intent names must not be
deleted merely to force a zero-finding assertion. Do not weaken unknown-script or
custom-shell guards to make the invariance test pass.

After a mutation survives, inspect the concrete change: add a meaningful positive/
negative control if behavior was untested, or document an equivalent mutant. Do not
raise coverage claims from a raw mutation score or disable transformations simply
to turn the run green.

## Native source-audit validation targets

Reusable memory comparisons live in [`bench/source-memory/`](../bench/source-memory/README.md).
Run `bun run bench:source-memory -- --help` for synthetic SFC/config controls or an
existing target repository. This is opt-in, not a new CI benchmark. Raw local
measurements remain under ignored output directories.

### Resource limits

`bun run test` uses two **file workers** (`--parallel=2`), a 2,048 MiB sampled
process-tree RSS budget and a 180 s deadline. `--max-concurrency` controls tests
within a worker; it does not cap file-worker processes. The supervisor directly
kills observed descendants (including separate process groups) before their
wrapper. `--no-orphans` supplements this; it was insufficient alone for a
microtask-starved worker. Cleanup regressions inspect liveness at the runner's exit,
not only after output EOF, which can hide a surviving child.

The three `test:slow:mutation:source-*` commands run the local runner with one
bounded parent, two mutant workers and Bun file workers, with a 1,536 MiB tree
budget and a 30-minute overall deadline.
`test:mutation:source` is the internal command used inside that bounded runner;
do not use it for unbounded manual mutant replay. Do not overlap full tests,
mutation trials and manual replay jobs.

`scripts/run-bounded.ts` samples RSS every 100 ms, including descendants in
different process groups. This is a fail-fast guard, **not an OS hard memory
limit**: short spikes between samples can exceed the threshold. Sampling failure
fails closed. Exit 137 means the memory guard fired, 124 means deadline, and 125
means guard/setup failure; none is a passing test or proof of a killed mutant.
The runner currently requires POSIX `ps`/process groups and Bun's `--no-orphans`
support (verified with Bun 1.4.4). This affects development test commands, not the
published Node CLI. `boundary-bounded-runner.test.ts` verifies limits and cleanup
using allocation fixtures capped at 128 MiB, not unrestricted OOM experiments.

- Boundary/regression: `test/boundary-source-*.test.ts`, including shadowing,
  resolver ambiguity, every JS line terminator, thresholds and cyclic graphs.
  `boundary-source-reference-resolver.test.ts` adds JSONC properties, static map
  ownership/ambiguity and real analyzer canonicalization. `boundary-source-sfc.test.ts`
  checks framework offsets, script isolation, malformed/unsupported regions and
  no target execution, template imports and framework-generated-JS scope comparisons;
  `boundary-source-jest-aliases.test.ts` covers unwritten aliases and transparent wrappers.
  `boundary-source-resolution-safety.test.ts` pins exact/over traversal budgets,
  inheritance depth, unsupported modifiers and SFC parser/scaffold selection.
- Entry points: `test/analyze-repository-source-imports.test.ts` and
  `test/source-audit-e2e.test.ts`; separate package smoke tests install production
  dependencies only and check the Node CLI with no Oxlint package present.
- Property/metamorphic/differential: `test/fuzz-source-audit.test.ts`.
  `SOURCE_AUDIT_FUZZ_RUNS=2000 FAST_CHECK_SEED=20261113 bun run test test/fuzz-source-audit.test.ts`.
  The graph oracle uses an independently implemented fixed-point closure;
  duplicate/reordered facts must not inflate results. Interrupts fail, not pass.
- Combinatorial: `test/pairwise-cluster-source-audit.test.ts` checks all declared
  parameter pairs and real findings; it is not exhaustive over all combinations.
- Mutation: `bun run test:slow:mutation:source-audit`.
  The sandbox mutates eight named modules, including scan orchestration and
  external snapshot parsing, not all repository
  collectors. No in-place rewrite. JSON evidence is saved under `docs/internal/`.
  Surviving mutants need review; timeouts are reported separately from kills.
  `bun run test:slow:mutation:source-collectors` checks source gates/report builders;
  `bun run test:slow:mutation:source-resolution` checks config/package maps and SFC
  extraction. Separate trial reports must not be presented as whole-program proof.
- Coverage-guided: build with
  `bun build src/repository-diagnostics/source-audit-parser.ts --target node --format esm --outfile dist/fuzz-source-audit.mjs --external oxc-parser`.
  Copy `fuzz/corpus/source-audit/` to a temporary/ignored corpus directory, then run
  `bunx --no-install jazzer fuzz/source-audit.fuzz.mjs <corpus> -- -max_total_time=20 -max_len=4096`.
  This instruments the JS extraction boundary, not the native Rust parser.
- Line/function coverage can be collected with `bun run test --coverage` on those
  tests. High line coverage is not branch completeness or mutation strength.
- Existing golden/reporter, CLI, workflow partitioning and cross-platform suites
  remain in `bun run test`; those methods do not imply source rules support every
  CI dialect. Source finding entrypoints are explicitly checked for all four CI
  dialects in `test/boundary-source-audit-followups.test.ts`.
- Optional source models for Lean/Alloy/TLA+ run with
  `bun run --cwd formal verify:models` after providing local tool paths;
  see `formal/README.md` for assumptions, finite scopes and intentional mutants.

## `analysisWarnings` map (reference)

`ReportData.analysisWarnings` is internal scan telemetry, not primary user-facing output.

| Source area | File | Example warning shape | Notes |
| --- | --- | --- | --- |
| Workflow parse | `src/repo.ts` | `Failed to parse workflow: ...` | Emitted when one workflow file cannot be parsed. |
| Rule execution | `src/rule-engine/execute.ts` | `Rule <id> failed: ...` | Per-rule failure guardrail. |
| Repository signal orchestration | `src/repository-signals.ts` | `<label> failed: ...` | Collector-family failure wrapper. |
| Repository file read / JSON parse | `src/repository-scan-context.ts` | `Failed to read file while collecting repository signals: ...` / `Failed to parse JSON while collecting repository signals: ...` | Common source for malformed `package.json` cases. |
| Repository diagnostics collector wrapper | `src/repository-diagnostics/index.ts` | `Collector <id> failed: ...` | Per-collector failure guardrail. |
| Docker build target fallback | `src/repository-diagnostics/docker-build-targets.ts` | collector-specific `context.warn(...)` | Narrow helper warning path. |
| Native source audits | `src/repository-diagnostics/source-audit.ts` | `source-audit` | Unsupported component files, JS/TS parse failures; boundary and Node CLI tests cover syntax/provenance/exclusions without a linter runtime. |

### Test guidance for `analysisWarnings`

- Assert membership, not position.
- Prefer `some(...)` or filtered matches over `analysisWarnings[0]`.
- Treat fire-and-forget prewarm work as non-observable. Background cache warmup should not mutate report warnings.
- Do not expose `analysisWarnings` in default `text`, `markdown`, or `handoff` output unless the output contract is intentionally changing.
