# Lean pilot: evidence strength, pruning, and gate expressions

Run `bun run verify:formal` with Lean **4.35.0** installed (elan reads
`formal/lean-toolchain`), or set `LEAN_BIN=/absolute/path/to/lean`.
No Mathlib, Lake dependencies, or generated fixtures.
Individual checks: `bun run verify:formal:gates` or `bun run verify:formal:gate-expr`.
CI runs all verifiers in the `formal` job; ordinary regression tests need no Lean.

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

## Ordered gate-expression semantics

`GateExpr.lean` models `collector-types.ts` result evaluation and `gate-expr.ts`
simplify/flatten operations at `c31cf22`. Production behavior is unchanged.
The specified policy is **ordered fail-fast**, not commutative Boolean logic:

| Left operand | AND | OR |
|---|---|---|
| resolved false | resolved false | right operand |
| resolved true | right operand | resolved true |
| skipped/error | left operand, same reason | left operand, same reason |

NOT flips only resolved values; skipped/error and their reasons remain unchanged.
The first unresolved operand wins, even if a later error or decisive Boolean
exists. Legacy selection precedence is expression, nonempty gates array, single
gate, then unrestricted true. Empty arrays fall through to the single gate.

### Universal model proofs

- `simplify_preserves_result`: deduplication and double-negation elimination
  preserve the **exact** result, including arbitrary reason strings, for all
  finite ASTs and assignments. The model also preserves TS's intentional failure
  to recognize NOT nodes in `gatesEqual`.
- `flattenAnd_preserves_result` / `flattenOr_preserves_result`: reassociation,
  without operand reordering, preserves the exact result for all finite ASTs.
- `resolved_agrees_with_boolean`: the result evaluator matches ordinary Boolean
  evaluation when all gates are resolved. The Boolean API's missing=false default
  is not a semantics for skipped/error; in particular, NOT skipped must not enable
  a collector as NOT false would.
- `not_skipped` / `not_error`: negation cannot turn an unresolved atom into true.

### Counterexamples and policy boundary

Lean proves ordering counterexamples: skipped OR true differs from true OR skipped;
error AND false differs from false AND error. Distribution can change a resolved
false into an error by evaluating an operand previously bypassed by short-circuiting.
These prohibit otherwise familiar Boolean rewrites under the existing policy.
They do **not** establish an active diagnostic omission: the currently registered
OR expression uses Husky/tooling gates, both resolved by the current collector.
Changing to an order-independent unknown/error policy needs a separate decision.

### Executable comparison

The bridge checks **26,752** expression/assignment pairs: all 411 ASTs of sizes
1–5 over three gates plus seven targeted deeper ASTs, across all 64 assignments
of false/true/skipped/error. Reasons differ by gate, so incorrect provenance is
observable. For each pair it compares the real public collector evaluator, all
three transformed AST shapes, and all transformed results against Lean.
Another **7,744** legacy list cases cover lengths 0–4, including repeats and empty
lists, and agreement with `gateExprFromLegacy`. **3,344** fully resolved expression
cases additionally compare Boolean and traced evaluation results.

`test/boundary-gate-result-semantics.test.ts` independently checks the result table,
counterexamples, distinct reasons, transform invariance, legacy precedence, and
actual right-operand reads. Lean's model is pure and total, so its proofs do not
claim evaluation-count, getter/proxy, trace-shape, or resource-exhaustion guarantees.
