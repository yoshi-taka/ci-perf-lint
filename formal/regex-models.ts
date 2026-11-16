/** Optional Bun + Z3 bridge for the regex mutator decision table.
 *
 * Scope: the Boolean anchor-removal rule and finite flip checks. Scanner
 * behaviour and parity with weapon-regex are bounded differential evidence,
 * not proved here. Not a product or default-CI dependency.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool } from "z3-solver";
import {
  anchorRemovalLength,
  mutateRegexPattern,
} from "../src/mutation/regex-mutator.ts";

const api = await init();
try {
  const context = new api.Context("regex");
  const { Bool, Int, Solver, And, Or, Not } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);
  async function check(formula: Z3Bool<"regex">, expected: "sat" | "unsat", label: string) {
    solver.reset();
    solver.add(length.eq(context.If(two, Int.val(2), Int.val(1))));
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  }

  const atStart = Bool.const("atStart");
  const nextPipe = Bool.const("nextPipe");
  const prevPipe = Bool.const("prevPipe");
  const two = And(atStart, Or(nextPipe, prevPipe));
  const length = Int.const("length");
  await check(Or(length.lt(1), length.gt(2)), "unsat", "anchor length stays in {1,2}");
  await check(And(length.eq(2), Not(two)), "unsat", "two chars requires start and pipe");
  await check(And(Not(two), length.eq(2)), "unsat", "start and pipe implies two chars");

  for (const a of [false, true]) {
    for (const n of [false, true]) {
      for (const p of [false, true]) {
        const expected = a && (n || p) ? 2 : 1;
        assert.equal(
          anchorRemovalLength(a, n, p),
          expected,
          `anchorRemovalLength(${a},${n},${p})`,
        );
      }
    }
  }

  const broken = Or(nextPipe, prevPipe);
  await check(
    Or(And(two, Not(broken)), And(Not(two), broken)),
    "sat",
    "a rule that ignores the alternative start is detected",
  );

  for (const [pattern, expected] of [
    ["\\d", "\\D"],
    ["\\D", "\\d"],
    ["\\s", "\\S"],
    ["\\S", "\\s"],
    ["\\w", "\\W"],
    ["\\W", "\\w"],
  ] as const) {
    const mutants = mutateRegexPattern(pattern, "");
    assert.deepEqual(mutants, [expected], `${pattern} flips once`);
    assert.deepEqual(mutateRegexPattern(expected, ""), [pattern], `${pattern} flips back`);
  }

  assert.deepEqual(mutateRegexPattern("\\p{Alpha}", "u"), ["\\P{Alpha}"]);
  assert.deepEqual(mutateRegexPattern("\\P{Alpha}", "u"), ["\\p{Alpha}"]);
  assert.deepEqual(mutateRegexPattern("[a]", ""), ["[^a]"]);
  assert.deepEqual(mutateRegexPattern("[^a]", ""), ["[a]"]);
  console.log("[z3] regex anchor bounds and flips hold");
} finally {
  await killThreads(api.em);
}
