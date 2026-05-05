# Testing Policy

## Testing approaches overview

| Approach | Files | Purpose |
|---|---|---|
| **Boundary / unit** | `test/boundary-*.test.ts` | BVA/EP on individual functions |
| **Integration (fixture)** | `test/analyze-repository-*.test.ts` | End-to-end with mini-repo fixtures |
| **CLI surface** | `test/cli.test.ts` | Argument parsing, exit codes, flags |
| **Golden regression** | `test/golden.test.ts` | Snapshot JSON output comparison |
| **Cross-platform invariance** | `test/cross-platform-invariance.test.ts` | Same rule fires identically across CI types |
| **Fuzzing** | `test/fuzz-*.test.ts` | Property-based invariant testing (fast-check) |
| **Pairwise / combinatorial** | `test/pairwise-cluster-*.test.ts` | All-pairs interaction coverage across rule clusters |
| **Reporter rendering** | `test/reporters-render-report.test.ts` | Text / JSON / markdown / handoff output format |
| **Reporter aggregation** | `test/reporters-aggregation.test.ts` | Grouped findings, deduplication |
| **Metamorphic / differential** | `test/boundary-metamorphic.test.ts` | Oracle-less invariant verification |
| **Mutation** | `stryker/stryker.*.config.mjs` | Stryker mutation testing (opt-in, slow) |

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

## Anti-patterns

- Do not add new tests back into a single catch-all `main.test.ts`.
- Do not create one test file per rule unless the rule needs substantial dedicated setup.
- Do not duplicate large fixture path lists across multiple test files.

## Fuzzing

- Use `fast-check` first for parser, CLI, and renderer invariants.
- Put Bun property tests in `test/fuzz-*.test.ts`.
- Use `jazzer.js` only for isolated coverage-guided targets under `fuzz/*.fuzz.mjs`.
- Keep `jazzer.js` out of the default `bun test` path.
- Prefer parser/renderer entrypoints with explicit allowed-error filtering.
- Build standalone fuzz targets with `bun run build:fuzz-targets`.
- Quick checks:
  - `bun run test:fuzz:fast`
  - `bun run test:fuzz:jazzer -max_total_time=2`
- If adding a new fuzz target:
  - add one `fuzz/*.fuzz.mjs` file
  - keep input coercion local to that file
  - register any new standalone entry in `knip.json` if needed

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

## Mutation Testing (Stryker)

- Mutation testing via Stryker for targeted source files where correctness is critical.
- Configs: `stryker/stryker.{core,helper,repo,renderer}.config.mjs`.
- Run: `bun run test:slow:mutation` (not in default `bun test` path; intentionally slow).
- Covered modules:
  - `src/finding-grouping.ts`, `src/repository-package-helpers.ts`, `src/cli-option-resolver.ts`
  - `src/reporters.ts`, `src/reporters-render.ts`, `src/rule-engine.ts`
  - `src/repo.ts`, `src/repository-signals.ts`, `src/rules/*.ts`
- Add a new Stryker config when adding a new module whose mutation coverage should be tracked.
- Use `command` test runner with a focused test command to keep per-config runs fast.

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
- Keep metamorphic tests in `test/boundary-metamorphic.test.ts`. Add new relations
  as new `test()` blocks in the existing `describe("metamorphic relations")` block.
- Avoid re-testing individual rule logic. Metamorphic tests target cross-cutting
  pipeline invariants (partitioning, ordering, rendering), not rule correctness.

## `analysisWarnings` map

`ReportData.analysisWarnings` is internal scan telemetry, not primary user-facing output.

| Source area | File | Example warning shape | Notes |
| --- | --- | --- | --- |
| Workflow parse | `src/repo.ts` | `Failed to parse workflow: ...` | Emitted when one workflow file cannot be parsed. |
| Rule execution | `src/rule-engine.ts` | `Rule <id> failed: ...` | Per-rule failure guardrail. |
| Repository signal orchestration | `src/repository-signals.ts` | `<label> failed: ...` | Collector-family failure wrapper. |
| Repository file read / JSON parse | `src/repository-scan-context.ts` | `Failed to read file while collecting repository signals: ...` / `Failed to parse JSON while collecting repository signals: ...` | Common source for malformed `package.json` cases. |
| Repository diagnostics collector wrapper | `src/repository-diagnostics/index.ts` | `Collector <id> failed: ...` | Per-collector failure guardrail. |
| Docker build target fallback | `src/repository-diagnostics/docker-build-targets.ts` | collector-specific `context.warn(...)` | Narrow helper warning path. |
| Embedded Oxlint runtime | `src/repository-diagnostics/embedded-oxlint-runner.ts` | `Embedded Oxlint ...` | Binary missing, stderr, bad JSON, exit-without-json, runtime failure. |

### Test guidance for `analysisWarnings`

- Assert membership, not position.
- Prefer `some(...)` or filtered matches over `analysisWarnings[0]`.
- Treat fire-and-forget prewarm work as non-observable. Background cache warmup should not mutate report warnings.
- Do not expose `analysisWarnings` in default `text`, `markdown`, or `handoff` output unless the output contract is intentionally changing.
