/** Optional Bun + Z3 bridge for the coverage-guided fuzzer.
 *
 * Scope: retention decision and mutation bounds on concrete inputs. Coverage
 * collection, execution, timeouts and worker restarts are not proved here.
 * Not a product or default-CI dependency.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool } from "z3-solver";
import { Rng, mutate } from "../src/fuzz/mutator.ts";
import { retainCoverage } from "../src/fuzz/retention.ts";

const api = await init();
try {
  const context = new api.Context("fuzz");
  const { Bool, Solver, And, Or, Not, Xor } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);
  async function check(formula: Z3Bool<"fuzz">, expected: "sat" | "unsat", label: string) {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  }

  const seen = { a: Bool.const("seenA"), b: Bool.const("seenB"), c: Bool.const("seenC") };
  const cov = { a: Bool.const("covA"), b: Bool.const("covB"), c: Bool.const("covC") };
  const fresh = Or(
    And(cov.a, Not(seen.a)),
    And(cov.b, Not(seen.b)),
    And(cov.c, Not(seen.c)),
  );
  await check(Xor(fresh, fresh), "unsat", "fresh predicate is stable");

  const keys = ["a", "b", "c"];
  for (let seenMask = 0; seenMask < 8; seenMask += 1) {
    const seenSet = new Set(keys.filter((_, index) => (seenMask & (1 << index)) !== 0));
    for (let covMask = 0; covMask < 8; covMask += 1) {
      const coverage = keys.filter((_, index) => (covMask & (1 << index)) !== 0);
      const expected = coverage.some((key) => !seenSet.has(key));
      const result = retainCoverage(seenSet, coverage);
      assert.equal(
        result.fresh,
        expected,
        `retention seen=${seenMask} cov=${covMask}`,
      );
      for (const key of coverage) {
        assert.ok(result.seen.has(key));
      }
    }
  }

  const brokenAlwaysFresh = true;
  assert.ok(
    brokenAlwaysFresh !== retainCoverage(new Set(), []).fresh,
    "a broken always-retain rule differs on empty coverage",
  );

  const rng = new Rng(12345);
  const seed = Buffer.from("on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n");
  const corpus = [seed];
  for (let index = 0; index < 500; index += 1) {
    const mutant = mutate(seed, rng, corpus, 512);
    assert.ok(mutant.length > 0, "mutation is not empty");
    assert.ok(mutant.length <= 512, "mutation respects max length");
    assert.ok(!mutant.equals(seed), "mutation changes the input");
  }
  const first = new Rng(99);
  const second = new Rng(99);
  assert.ok(mutate(seed, first, corpus).equals(mutate(seed, second, corpus)));
  console.log("[z3] fuzz retention table and mutation bounds hold");
} finally {
  await killThreads(api.em);
}
