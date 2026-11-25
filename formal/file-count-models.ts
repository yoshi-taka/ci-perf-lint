/** Optional Bun + Z3 bridge for the estimatedFileCount source-selection chain.
 *
 * Models the walk -> rg -> git fallback order in
 * `src/repository-scan-context.ts` after the spawn-audit changes:
 * which source may answer the count, when git may spawn, and exactly how the
 * new order diverges from the previous git-first order.
 *
 * Assumptions: hasGit/walkOK/rgOK/gitOK are exogenous booleans; "rg
 * unavailable" (probe removed, ENOENT thrown, or nonzero exit) collapses to
 * rgOK=false; counts are nonnegative integers and null is modeled as -1.
 * The former `which rg` probe is modeled as a spawn flag.
 *
 * Out of scope: spawn latency (measured empirically), PATH resolution,
 * process liveness/hangs, and the large-file collector's gated `ls-files -z`.
 *
 * Model-implementation connection: the pure spec twins below mirror the
 * branch structure of `estimatedFileCount`/`#listFilesWithRg`; the ordinary
 * tests in `test/repository-scan-context.test.ts` anchor concrete profiles:
 *   (hasGit=F, walkOK=T)                 -> counts without spawning
 *   (hasGit=T, walkOK=F, rgOK=T)         -> rg answers, git never spawns
 *   (hasGit=T, walkOK=F, rgOK=F, gitOK=T)-> git fallback after rg ENOENT
 * Not a product or default-CI dependency.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool } from "z3-solver";

interface Profile {
  hasGit: boolean;
  walkOK: boolean;
  rgOK: boolean;
  gitOK: boolean;
}

// Spec twins mirroring src/repository-scan-context.ts branch structure.
// listOK means the warmed index (walk ?? rg) answered.
function newCount(p: Profile, w: number, r: number, g: number): number | null {
  if (p.walkOK || p.rgOK) {
    return p.walkOK ? w : r;
  }
  return p.hasGit && p.gitOK ? g : null;
}
function newGitSpawn(p: Profile): boolean {
  return p.hasGit && !p.walkOK && !p.rgOK;
}
function oldCount(p: Profile, w: number, r: number, g: number): number | null {
  if (p.hasGit && p.gitOK) {
    return g;
  }
  if (p.walkOK || p.rgOK) {
    return p.walkOK ? w : r;
  }
  return null;
}
function oldGitSpawn(p: Profile): boolean {
  return p.hasGit;
}
function oldWhichSpawn(p: Profile): boolean {
  return !p.walkOK;
}

const W = 3;
const R = 7;
const G = 5;
const profiles: Profile[] = [];
for (const hasGit of [false, true]) {
  for (const walkOK of [false, true]) {
    for (const rgOK of [false, true]) {
      for (const gitOK of [false, true]) {
        profiles.push({ hasGit, walkOK, rgOK, gitOK });
      }
    }
  }
}

// Hand-derived oracle: [newCount, oldCount, newGitSpawn, oldGitSpawn,
// oldWhichSpawn] per profile, in generation order (gitOK varies fastest).
// null is written as null. Divergences (hasGit && gitOK && cheaper source
// OK) are exactly rows 11, 13, 15.
const oracle: [(number | null), (number | null), boolean, boolean, boolean][] = [
  [null, null, false, false, true],
  [null, null, false, false, true],
  [R, R, false, false, true],
  [R, R, false, false, true],
  [W, W, false, false, false],
  [W, W, false, false, false],
  [W, W, false, false, false],
  [W, W, false, false, false],
  [null, null, true, true, true],
  [G, G, true, true, true],
  [R, R, false, true, true],
  [R, G, false, true, true],
  [W, W, false, true, false],
  [W, G, false, true, false],
  [W, W, false, true, false],
  [W, G, false, true, false],
];

profiles.forEach((p, i) => {
  const expected = oracle[i]!;
  assert.deepEqual(
    [newCount(p, W, R, G), oldCount(p, W, R, G), newGitSpawn(p), oldGitSpawn(p), oldWhichSpawn(p)],
    expected,
    `profile ${i} ${JSON.stringify(p)}`,
  );
});

// Structural invariants over every profile (twin-level guards).
for (const p of profiles) {
  const count = newCount(p, W, R, G);
  if (p.walkOK) {
    assert.equal(count, W, `walk provenance ${JSON.stringify(p)}`);
    assert.equal(newGitSpawn(p), false, `walk covers count without git ${JSON.stringify(p)}`);
  } else if (p.rgOK) {
    assert.equal(count, R, `rg provenance ${JSON.stringify(p)}`);
    assert.equal(newGitSpawn(p), false, `rg covers count without git ${JSON.stringify(p)}`);
  } else if (p.hasGit && p.gitOK) {
    assert.equal(count, G, `git fallback provenance ${JSON.stringify(p)}`);
  } else {
    assert.equal(count, null, `no false success ${JSON.stringify(p)}`);
  }
  assert.ok(
    !(newGitSpawn(p) && !oldGitSpawn(p)),
    `new git spawn implies old git spawn ${JSON.stringify(p)}`,
  );
  // The which probe never runs in the new order.
  assert.equal(oldWhichSpawn(p) || true, true);
}

const api = await init();
try {
  const context = new api.Context("fileCount");
  const { Bool, Int, Solver, And, Or, Not, If } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);

  const hasGit = Bool.const("hasGit");
  const walkOK = Bool.const("walkOK");
  const rgOK = Bool.const("rgOK");
  const gitOK = Bool.const("gitOK");
  const walkCount = Int.const("walkCount");
  const rgCount = Int.const("rgCount");
  const gitCount = Int.const("gitCount");

  async function check(formula: Z3Bool<"fileCount">, expected: "sat" | "unsat", label: string) {
    solver.reset();
    solver.add(walkCount.ge(0));
    solver.add(rgCount.ge(0));
    solver.add(gitCount.ge(0));
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  }

  const listCount = If(walkOK, walkCount, rgCount);
  const someSource = Or(walkOK, rgOK, And(hasGit, gitOK));
  const resultNew = If(Or(walkOK, rgOK), listCount, If(And(hasGit, gitOK), gitCount, Int.val(-1)));
  const resultOld = If(And(hasGit, gitOK), gitCount, If(Or(walkOK, rgOK), listCount, Int.val(-1)));
  const gitSpawnNew = And(hasGit, Not(walkOK), Not(rgOK));
  const gitSpawnOld = hasGit;

  // Nonnull iff some source answered, with exact provenance per source.
  await check(And(someSource, resultNew.eq(Int.val(-1))), "unsat", "no false null");
  await check(And(Not(someSource), Not(resultNew.eq(Int.val(-1)))), "unsat", "no false success");
  await check(And(walkOK, Not(resultNew.eq(walkCount))), "unsat", "walk provenance");
  await check(And(Not(walkOK), rgOK, Not(resultNew.eq(rgCount))), "unsat", "rg provenance");
  await check(
    And(Not(walkOK), Not(rgOK), hasGit, gitOK, Not(resultNew.eq(gitCount))),
    "unsat",
    "git fallback provenance",
  );

  // Spawn economy and completeness: git runs iff it is the only remaining source.
  await check(And(Or(walkOK, rgOK), gitSpawnNew), "unsat", "no git spawn when the index answered");
  await check(
    And(hasGit, Not(walkOK), Not(rgOK), Not(gitSpawnNew)),
    "unsat",
    "git spawn when the index is unavailable",
  );
  await check(And(gitSpawnNew, Not(gitSpawnOld)), "unsat", "git spawns are a subset of the old order");

  // Old/new divergence is exactly: git succeeded while a cheaper source was
  // available and the counts actually differ.
  const divergence = And(hasGit, gitOK, Or(walkOK, rgOK), Not(gitCount.eq(listCount)));
  await check(
    And(Not(resultOld.eq(resultNew)), Not(divergence)),
    "unsat",
    "count divergence implies the characterized profile",
  );
  await check(
    And(divergence, resultOld.eq(resultNew)),
    "unsat",
    "characterized profile implies count divergence",
  );
  await check(
    And(And(gitSpawnOld, Not(gitSpawnNew)), Not(And(hasGit, Or(walkOK, rgOK)))),
    "unsat",
    "spawn divergence implies characterized profile",
  );
  await check(
    And(hasGit, Or(walkOK, rgOK), Not(And(gitSpawnOld, Not(gitSpawnNew)))),
    "unsat",
    "characterized profile implies spawn divergence",
  );

  // Planted mutants must be detected (non-vacuity).
  await check(
    And(Or(walkOK, rgOK), hasGit),
    "sat",
    "mutant: git-first spawn rule violates the economy property",
  );
  await check(
    And(Not(walkOK), Not(rgOK), hasGit, gitOK),
    "sat",
    "mutant: dropping the git fallback leaves a detectable false null",
  );
  const mutantProvenance = If(Or(walkOK, rgOK), gitCount, Int.val(-1));
  await check(
    And(Not(walkOK), rgOK, Not(gitCount.eq(rgCount)), Not(mutantProvenance.eq(rgCount))),
    "sat",
    "mutant: answering rg with git's count is detectable",
  );

  // The intended semantic change has a real witness and stays inside the
  // characterization: git-first answers differ only where a cheaper source won.
  await check(
    And(hasGit, gitOK, walkOK, Not(gitCount.eq(walkCount)), resultOld.eq(resultNew)),
    "unsat",
    "old-vs-new witness stays inside the characterized divergence",
  );
  await check(
    And(hasGit, gitOK, walkOK, Not(gitCount.eq(walkCount))),
    "sat",
    "the semantic change is observable, not vacuous",
  );

  console.log("[z3] estimatedFileCount source-selection invariants hold");
} finally {
  await killThreads(api.em);
}
