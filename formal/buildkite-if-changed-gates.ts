/** Optional Bun + Z3/WASM gate-equivalence check for the
 * missing-if-changed default-branch restriction predicate.
 * Same local/optional status as ci-yaml-gate-parity.ts; run with
 * `bun --cwd formal buildkite-if-changed-gates.ts`.
 *
 * Question (constraints): does the implemented restriction predicate
 * agree with the intended specification on every representative
 * (branches form, if-expression form) pair, for every assignment of the
 * remaining boolean gates (heavy/deploy/own-detection/if_changed/skip)?
 *
 * Model correspondence: the TS side measures the real exported
 * predicate (real parser output for each form); the Z3 side proves
 * equivalence of the transcribed predicates over the full finite grid.
 * The specification is: restricted iff branches is main-only, or the
 * if expression restricts the step TO the default branch. A negated
 * main comparison (`build.branch != "main"`) restricts the step
 * everywhere EXCEPT the default branch — the opposite gate.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool, type DatatypeSort, type Expr } from "z3-solver";
import { parsePipeline } from "../src/buildkite-workflow.ts";
import { stepPinnedToBranches } from "../src/rules/missing-if-changed.ts";

const BRANCH_FORMS = [
  "absent",
  "main",
  "master",
  "develop release",
  "!main",
  "main feature/*",
  "feature/*",
] as const;
const IF_FORMS = [
  "absent",
  'build.branch == "main"',
  'build.branch == "master"',
  'build.branch != "main"',
  'build.message != "skip me"',
] as const;

// Specification: a step is pinned when its branches filter is bare names
// only (no negation, no globs — main, master, anything), or its if
// expression pins it with a branch equality comparison. The default
// branch name is a repository setting, never stated in a pipeline file.
function pinnedSpec(branches: string, ifExpr: string): boolean {
  const tokens = branches.trim() ? branches.split(/[\s,]+/).filter(Boolean) : [];
  const bareNames = tokens.length > 0 && tokens.every((t) => !t.startsWith("!") && !t.includes("*"));
  const eqBranch = /build\.branch\s*==/.test(ifExpr);
  return bareNames || eqBranch;
}

// TS bridge: measure the real predicate through the real parser.
function pinnedImpl(branches: string, ifExpr: string): boolean {
  const lines = ["steps:", "  - label: T", "    command: npm test"];
  if (branches) {
    lines.push(`    branches: "${branches}"`);
  }
  if (ifExpr !== "absent") {
    lines.push(`    if: '${ifExpr}'`);
  }
  const doc = parsePipeline("/repo/.buildkite/pipeline.yml", "/repo", lines.join("\n"));
  const step = doc.steps[0];
  assert.ok(step, "expected a parsed step");
  return stepPinnedToBranches(step);
}

const api = await init();
try {
  // ---- TS differential over the concrete form grid -------------------
  const mismatches: string[] = [];
  for (const branches of BRANCH_FORMS) {
    for (const ifExpr of IF_FORMS) {
      const impl = pinnedImpl(branches === "absent" ? "" : branches, ifExpr);
      const spec = pinnedSpec(branches === "absent" ? "" : branches, ifExpr);
      if (impl !== spec) {
        mismatches.push(
          `branches=${branches === "absent" ? "(absent)" : branches} if=${ifExpr}: impl pinned=${impl}, spec pinned=${spec}`,
        );
      }
    }
  }

  // ---- Z3 equivalence over the full boolean grid ---------------------
  const context = new api.Context("gates");
  const { Datatype, Solver } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);

  // Branch-form classes: absent; bare names (main, master, develop
  // release); anything with a negation or glob (!main, main feature/*,
  // feature/*). The default branch is never named in the pipeline file,
  // so bare names are treated as potentially-default.
  const Branch = Datatype("Branch");
  Branch.declare("bAbsent");
  Branch.declare("bBareNames");
  Branch.declare("bNegOrGlob");
  const BranchT: DatatypeSort<"gates"> = Branch.create();
  // Nullary constructor values are attached dynamically by the JS API
  // and are absent from DatatypeSort's static surface.
  type FormCtor = Expr<"gates", DatatypeSort<"gates">>;
  const branchCtors = BranchT as unknown as Record<
    "bAbsent" | "bBareNames" | "bNegOrGlob",
    FormCtor
  >;

  // If-form classes: no expression; a branch equality (covers == for any
  // branch name and mixed eq/ne forms); a bare branch inequality; an
  // expression without branch comparisons.
  const If = Datatype("IfForm");
  If.declare("iAbsent");
  If.declare("iEqBranch");
  If.declare("iNeBranch");
  If.declare("iUnrelated");
  const IfT: DatatypeSort<"gates"> = If.create();
  const ifCtors = IfT as unknown as Record<
    "iAbsent" | "iEqBranch" | "iNeBranch" | "iUnrelated",
    FormCtor
  >;

  const b = context.Const("b", BranchT);
  const f = context.Const("f", IfT);
  const eq = (x: FormCtor | typeof f, y: FormCtor | typeof f) => context.Eq(x, y);

  const heavy = context.Bool.const("heavy");
  const deploy = context.Bool.const("deploy");
  const own = context.Bool.const("own");
  const ifChanged = context.Bool.const("ifChanged");
  const skipped = context.Bool.const("skipped");

  // Spec: pinned iff bare-name branches or a branch-equality if.
  const pinnedSpecZ3 = context.Or(eq(b, branchCtors.bBareNames), eq(f, ifCtors.iEqBranch));
  // Impl (transcribed from stepPinnedToBranches): a branch equality pins
  // the step outright; otherwise bare-name branches pin it.
  const pinnedImplZ3 = context.Or(eq(f, ifCtors.iEqBranch), eq(b, branchCtors.bBareNames));

  const firesSpec = context.And(
    heavy,
    context.Not(deploy),
    context.Not(own),
    context.Not(ifChanged),
    context.Not(skipped),
    context.Not(pinnedSpecZ3),
  );
  const firesImpl = context.And(
    heavy,
    context.Not(deploy),
    context.Not(own),
    context.Not(ifChanged),
    context.Not(skipped),
    context.Not(pinnedImplZ3),
  );

  async function check(formula: Z3Bool<"gates">, expected: "sat" | "unsat", label: string) {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(
      actual,
      expected,
      `${label}: expected ${expected}; got ${actual}${actual === "unknown" ? ` (${solver.reasonUnknown()})` : ""}`,
    );
  }

  // Defect: any input where the implemented predicate disagrees with spec.
  await check(
    context.And(firesSpec, context.Not(firesImpl)),
    "unsat",
    "spec-fires-but-impl-does-not (false negative)",
  );
  await check(
    context.And(firesImpl, context.Not(firesSpec)),
    "unsat",
    "impl-fires-but-spec-does-not (false positive)",
  );

  // Non-vacuity: the rule can fire on a legitimate input.
  await check(
    context.And(eq(b, branchCtors.bNegOrGlob), eq(f, ifCtors.iAbsent), firesSpec),
    "sat",
    "witness: branch-excluded heavy step fires",
  );

  // Exclusion: a step that already sets if_changed is never advised.
  await check(context.And(firesSpec, ifChanged), "unsat", "no advice when if_changed present");

  if (mismatches.length > 0) {
    console.error("TS differential found predicate disagreements:");
    for (const line of mismatches) {
      console.error(`  - ${line}`);
    }
    throw new Error(
      `predicate disagreements with the specification: ${mismatches.length} form pair(s)`,
    );
  }

  console.log("if-changed gates: differential grid + Z3 equivalence agree");
} finally {
  await killThreads(api.em);
}
