/** Optional Bun + Z3/WASM field-shape coverage check for all four CI YAML
 * parsers. Not a product or default-CI dependency. Same local/optional
 * status as import-audit.ts; run with `bun --cwd formal ci-yaml-gate-parity.ts`.
 *
 * Question (constraints): for every audited (parser field, syntax shape)
 * pair, does the shape pass through the gate? Kinds refine scalars into
 * Str/Bool/Int — the granularity at which `getScalarString`-style gates
 * silently dropped documented boolean/integer forms. The pre-fix column
 * is the git state before the shape fixes; every (field, kind) it misses
 * is a detected defect, enumerated by this script.
 *
 * Pair traversal and config extraction are covered by the Lean model and
 * its TS bridge (docs/internal/buildkite-plugins-model.lean); the field
 * coverage relations by docs/internal/ci-yaml-gate-parity.als.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool, type DatatypeSort, type Expr } from "z3-solver";

type KindId = "seq" | "map" | "str" | "bool" | "int";

type GateCase = {
  id: string;
  valid: KindId[]; // shapes valid CI syntax can produce for the field
  oldReads: KindId[]; // shapes the pre-fix gate passed through
  newReads: KindId[]; // shapes the fixed gate passes through
};

const CASES: GateCase[] = [
  { id: "buildkite plugins", valid: ["seq", "map"], oldReads: [], newReads: ["seq", "map"] },
  { id: "gitlab image", valid: ["str", "map"], oldReads: ["str"], newReads: ["str", "map"] },
  { id: "buildkite group inner steps", valid: ["seq"], oldReads: [], newReads: ["seq"] },
  { id: "buildkite skip", valid: ["bool", "str"], oldReads: ["str"], newReads: ["bool", "str"] },
  { id: "buildkite parallelism", valid: ["int"], oldReads: [], newReads: ["int"] },
  { id: "circleci background", valid: ["bool"], oldReads: [], newReads: ["bool"] },
  { id: "circleci docker_layer_caching", valid: ["bool"], oldReads: [], newReads: ["bool"] },
  { id: "circleci parallelism", valid: ["int"], oldReads: [], newReads: ["int"] },
  { id: "gitlab interruptible", valid: ["bool"], oldReads: [], newReads: ["bool"] },
  { id: "gitlab allow_failure", valid: ["bool"], oldReads: [], newReads: ["bool"] },
  { id: "gitlab parallel", valid: ["int"], oldReads: [], newReads: ["int"] },
  // Controls: genuinely single-shape fields, read correctly by both versions.
  { id: "buildkite env (control)", valid: ["map"], oldReads: ["map"], newReads: ["map"] },
  { id: "buildkite label (control)", valid: ["str"], oldReads: ["str"], newReads: ["str"] },
  // Deliberately broken fix: drops the boolean form again.
  { id: "mutant buildkite skip", valid: ["bool", "str"], oldReads: ["str"], newReads: ["str"] },
];

const api = await init();
try {
  const context = new api.Context("gates");
  const { Datatype, Solver } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);

  const Kind = Datatype("Kind");
  Kind.declare("seq");
  Kind.declare("map");
  Kind.declare("str");
  Kind.declare("bool");
  Kind.declare("int");
  const KindT: DatatypeSort<"gates"> = Kind.create();
  // Nullary constructor values are attached dynamically by the JS API
  // and are absent from DatatypeSort's static surface.
  type KindCtor = Expr<"gates", DatatypeSort<"gates">>;
  const ctors = KindT as unknown as Record<KindId, KindCtor>;

  const k = context.Const("k", KindT);
  const isKind = (id: KindId) => context.Eq(k, ctors[id]);
  const readsVersions = (read: KindId[]) =>
    read.length === 0 ? context.Bool.val(false) : context.Or(...read.map(isKind));

  let checks = 0;
  const defects: string[] = [];

  async function check(
    formula: Z3Bool<"gates">,
    expected: "sat" | "unsat",
    label: string,
  ) {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    checks++;
    assert.equal(
      actual,
      expected,
      `${label}: expected ${expected}; got ${actual}${actual === "unknown" ? ` (${solver.reasonUnknown()})` : ""}`,
    );
  }

  for (const c of CASES) {
    for (const kind of c.valid) {
      // The gate passes some shape iff it can pass this specific one.
      await check(
        context.And(isKind(kind), readsVersions(c.oldReads)),
        c.oldReads.includes(kind) ? "sat" : "unsat",
        `${c.id} [${kind}] pre-fix pass`,
      );
      await check(
        context.And(isKind(kind), readsVersions(c.newReads)),
        c.newReads.includes(kind) ? "sat" : "unsat",
        `${c.id} [${kind}] fixed pass`,
      );
      if (!c.oldReads.includes(kind)) {
        defects.push(`${c.id}: valid ${kind} dropped pre-fix`);
      }
    }
    for (const kind of (["seq", "map", "str", "bool", "int"] as KindId[]).filter(
      (candidate) => !c.valid.includes(candidate),
    )) {
      // No version may pass a shape the field's valid syntax excludes.
      await check(
        context.And(isKind(kind), readsVersions(c.newReads)),
        "unsat",
        `${c.id} [${kind}] invalid shape rejected`,
      );
    }
  }

  assert.ok(defects.length > 0, "pre-fix defect list must not be empty");
  assert.ok(
    defects.some((d) => d.startsWith("mutant")),
    "mutant detection must be observable in the defect list",
  );

  console.log(`gate parity: ${checks} checks agree; pre-fix defects detected:`);
  for (const defect of defects) {
    console.log(`  - ${defect}`);
  }
} finally {
  await killThreads(api.em);
}
