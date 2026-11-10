# Lean pilot: evidence strength and gate pruning

Run `bun run verify:formal` with Lean **4.35.0** installed (elan reads
`formal/lean-toolchain`), or set `LEAN_BIN=/absolute/path/to/lean`.
No Mathlib, Lake dependencies, or generated fixtures.
Gate checks alone: `bun run verify:formal:gates`.
CI runs both verifiers in the `formal` job; ordinary regression tests need no Lean.

## Scope and evidence

Source: `src/rules/shared/evidence.ts`, lines 36–69 at
`6d16a3ef435fd6b9c69682b8e88e63a3d2903b33`.
`priority` models both TS rank tables, `foldl updateBest` models the mutable
`best` loop, and `Graded` preserves the returned metadata.

- `minimum_exact`: acceptance matches an independent, explicit threshold table.
- `minimum_preserves_metadata`: strength and signals are unchanged.
- `minimum_monotone`: raising the threshold cannot enable acceptance.
- `fold_priority`: aggregation computes the maximum rank for any finite list.
- `combine_exact`: returns strong iff present, else medium iff present, else weak.
- `equal_threshold_accepted`: catches the strict-comparison boundary mutation.

The verifier first checks proofs with warnings treated as errors, then executes
the Lean model and compares **9,895** JSONL cases against the real TS functions:
54 threshold/metadata cases and all 9,841 strength lists of lengths 0–8.
Each printed theorem's axioms are reported; `sorryAx` is rejected.

## Trust boundary

This is a proved model plus differential testing, **not a proof of TS equivalence**.
Typed, immutable inputs only: invalid JS values, getters/proxies, allocation failure,
and signal-array identity are outside the model (the bridge checks TS identity).
TS ranks are small exact integers, so Lean naturals introduce no rounding difference
in this domain. A source change requires re-review of the model and rerunning tests.

Review status: author-reviewed only; independent review is still outstanding.
Do not count this as independently accepted coverage.
The strict-comparison mutation, an always-false gate, or an always-weak aggregator
would contradict the exact specifications, unlike a vacuous output-type theorem.

## Gate pruning and no-loss guards

`Gates.lean` models the state/skipped-status projection of
`src/repository-diagnostics/gate-pruning.ts`. The bridge calls that real TS helper
directly. For eager gate evaluation it exposes private leaf detectors from a
temporary copy of `gates.ts`, changing only import paths and the export list.
No detector or scheduling logic is substituted. Temporary files are cleaned up.

The Lean and TS executions agree on **4,096 cases**: all 64 topologically numbered
four-node DAGs × 16 initial Boolean states × four roots. All calls finish within
the model's explicit fuel bound. An independent BFS oracle checks reachability;
the bridge also checks skipped reasons, derivedFalse entries, and untouched gates.
Initial results are resolved, observability is empty, and reason equals root as
in production callers; other initial metadata states are outside this comparison.
Every reachable descendant must now be false **and skipped**, including paths
through false intermediates. Gates outside the reachable set must be untouched.

Lean checks `star_safe` for all Boolean assignments and `chain_cleared` for the
former three-node counterexample. These are not a universal proof for all DAGs;
the exhaustive differential comparison covers four-node, topologically numbered
DAGs. Ordinary TS tests additionally cover cycles, duplicate edges, repeat calls,
and existing observability reasons.

### Independent detector scheduling

Build-config and framework evidence do not imply the broad tooling heuristic.
Those two gates are now evaluated independently; only linting and package-script
gates retain the tooling prerequisite. The verifier compares all five JS gate
values with eagerly scheduled leaf detectors across **36 real repository shapes**:
all 24 recognized build-config filenames, independent framework/lint signals,
deployment/package-script evidence, Rust/empty controls, and the webpack regression
with and without a root package.json.

In every shape it also compares normal `analyzeRepository` findings for
`ts-loader-fork-ts-checker` against direct collector execution. The positive
webpack case must produce one finding even without package.json; adding an empty
package.json must not change those findings. This detects scheduling omissions,
not bugs shared by both uses of the same leaf detector.

`no_loss_with_prerequisite` proves the abstract optimization safe **under**
`child=true → parent=true`. `missing_prerequisite_counterexample` shows why the
assumption is necessary; it does not assert a remaining production defect.

### Regression entry points

- `test/boundary-gate-pruning.test.ts`: exhaustive traversal and metadata checks.
- `test/analyze-repository-gate-no-loss.test.ts`: 24 direct-vs-gated diagnostic
  cases across four webpack extensions, package.json presence, and unsafe/safe
  loader modes. Absence cases also reject skipped/failed collector telemetry.
- `.github/workflows/ci.yml`: ordinary tests plus Lean proof/model/TS comparisons;
  Lean is pinned by `lean-toolchain`, and the elan bootstrap is checksum-verified.

Green now requires corrected no-loss behavior, not reproduction of known failures.
Independent review remains outstanding for this pilot.
