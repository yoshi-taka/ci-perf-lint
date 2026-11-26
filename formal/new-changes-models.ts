/** Optional local formal check for workspace, orb/Gradle, Docker stage, and JS gate changes. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { init, killThreads } from "z3-solver";
import {
  collectDockerfileInstructions,
  collectReachableDockerfileInstructionIndexes,
} from "../src/repository-diagnostics/dockerfile-instructions.ts";

const directory = import.meta.dir;
const lean = process.env.LEAN_BIN;
const java = process.env.JAVA_BIN;
const alloy = process.env.ALLOY_JAR;
const tla = process.env.TLA_JAR;
assert.ok(
  lean && java && alloy && tla,
  "Set LEAN_BIN, JAVA_BIN, ALLOY_JAR and TLA_JAR to existing local tools.",
);

const output = await mkdtemp(
  path.join(process.env.TMPDIR ?? "/private/tmp", "ci-perf-new-changes-"),
);

async function run(args: string[], name: string, success = true): Promise<string> {
  const child = Bun.spawn(args, {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TMPDIR: output },
  });
  const timer = setTimeout(() => child.kill(), 180_000);
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const text = stdout + stderr;
    await Bun.write(path.join(output, `${name}.log`), text);
    if (success) {
      assert.equal(code, 0, `${name}: ${text}`);
    } else {
      assert.notEqual(code, 0, `${name}: intentional mutant was not rejected`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const leanOutput = await run(
  [lean, "-DwarningAsError=true", "CiPerfNewChanges.lean"],
  "lean",
);
assert.ok(!leanOutput.includes("sorryAx"), "Lean model used sorryAx");
const proofs = [...(await Bun.file(path.join(directory, "CiPerfNewChanges.lean")).text()).matchAll(
  /^#print axioms (\w+)/gm,
)];
assert.equal(proofs.length, 9);
for (const [, name] of proofs) {
  assert.ok(leanOutput.includes(`'CiPerfNewChanges.${name}'`), `Missing axiom audit ${name}`);
}
console.log("Lean: 9 axiom-audited theorems; no sorryAx.");

const alloyOutput = await run(
  [java, "-jar", alloy, "exec", "-o", path.join(output, "alloy"), "DockerReachability.als"],
  "alloy",
);
assert.equal((alloyOutput.match(/\bUNSAT\b/g) ?? []).length, 3, "Alloy positive checks");
assert.equal((alloyOutput.match(/\bSAT\b/g) ?? []).length, 2, "Alloy broken controls");
console.log("Alloy: reachability closure and least-fixed-point checks passed; 2 broken controls found.");

const tlaNormal = await run(
  [
    java,
    "-cp",
    tla,
    "tlc2.TLC",
    "-cleanup",
    "-metadir",
    path.join(output, "tla-normal-states"),
    "-config",
    "WorkspaceAnalysis.cfg",
    "-workers",
    "1",
    "WorkspaceAnalysis.tla",
  ],
  "tla-normal",
);
assert.match(tlaNormal, /No error has been found/);
const tlaMutant = await run(
  [
    java,
    "-cp",
    tla,
    "tlc2.TLC",
    "-cleanup",
    "-metadir",
    path.join(output, "tla-mutant-states"),
    "-config",
    "WorkspaceAnalysis.mutant.cfg",
    "-workers",
    "1",
    "WorkspaceAnalysis.tla",
  ],
  "tla-mutant",
  false,
);
assert.match(tlaMutant, /MergedSound is violated/);
console.log("TLA+: workspace lifecycle has no lost/duplicate merge; failed-report merge mutant rejected.");

const api = await init();
try {
  const context = new api.Context("new-changes");
  const { Bool, Int, Solver } = context;
  const And = context.And.bind(context);
  const Or = context.Or.bind(context);
  const Not = context.Not.bind(context);
  const includedA = Bool.const("included_a");
  const includedB = Bool.const("included_b");
  const includedC = Bool.const("included_c");
  const one = Int.val(1);
  const zero = Int.val(0);
  const count = one
    .add(context.If(includedA, one, zero))
    .add(context.If(includedB, one, zero))
    .add(context.If(includedC, one, zero));
  const multiModule = Or(includedA, Or(includedB, includedC));
  const countAtLeastTwo = count.ge(Int.val(2));
  const solver = new Solver();
  solver.set("timeout", 10_000);

  solver.add(Not(multiModule.eq(countAtLeastTwo)));
  assert.equal(
    await solver.check(),
    "unsat",
    "Gradle multi-module threshold must equal a nonempty include set",
  );

  const brokenCount = context
    .If(includedA, one, zero)
    .add(context.If(includedB, one, zero))
    .add(context.If(includedC, one, zero));
  solver.reset();
  solver.add(And(multiModule, Not(brokenCount.ge(Int.val(2)))));
  assert.equal(await solver.check(), "sat", "Two-include threshold mutant must be falsifiable");
  console.log("Z3: Gradle threshold equals root-plus-nonempty-include; mutant falsifiable.");
} finally {
  await killThreads(api.em);
}

const stageCount = 4;
const possibleEdges: [number, number][] = [];
for (let target = 0; target < stageCount; target++) {
  for (let source = 0; source < target; source++) {
    possibleEdges.push([target, source]);
  }
}
const outputAliases = ["s0", "s1", "s2", "s3"];
let graphCases = 0;
for (let mask = 0; mask < 1 << possibleEdges.length; mask++) {
  const edges = possibleEdges.filter((_, index) => (mask & (1 << index)) !== 0);
  const fromByStage = new Map<number, number[]>();
  for (const [target, source] of edges) {
    const list = fromByStage.get(target) ?? [];
    list.push(source);
    fromByStage.set(target, list);
  }
  const lines: string[] = [];
  const stageInstructionIndexes: number[][] = [];
  for (let stage = 0; stage < stageCount; stage++) {
    const indexes: number[] = [];
    indexes.push(lines.length);
    lines.push(`FROM alpine AS s${stage}`);
    for (const source of fromByStage.get(stage) ?? []) {
      indexes.push(lines.length);
      lines.push(`COPY --from=s${source} /x /x`);
    }
    stageInstructionIndexes.push(indexes);
  }
  const instructions = collectDockerfileInstructions(lines);
  const edgesOf = (stage: number): number[] => fromByStage.get(stage) ?? [];

  for (const [targetIndex, targetAlias] of outputAliases.entries()) {
    const actual = collectReachableDockerfileInstructionIndexes(instructions, targetAlias);
    assert.ok(actual, `reachability must resolve for graph ${mask}/${targetAlias}`);
    const reached = new Set<number>();
    const stack = [targetIndex];
    while (stack.length > 0) {
      const stage = stack.pop()!;
      if (reached.has(stage)) {
        continue;
      }
      reached.add(stage);
      stack.push(...edgesOf(stage));
    }
    const expected = new Set(
      [...reached].flatMap((stage) => stageInstructionIndexes[stage]!),
    );
    assert.deepEqual(
      [...actual].sort((a, b) => a - b),
      [...expected].sort((a, b) => a - b),
      `Docker reachability mismatch for graph ${mask}, target ${targetAlias}`,
    );
    graphCases++;
  }
}
assert.equal(graphCases, 256, "Expected all 64 four-stage graphs × 4 target aliases");

// Broken oracle control: one-step reachability must miss a transitive stage.
const chainInstructions = collectDockerfileInstructions([
  "FROM alpine AS s0",
  "FROM alpine AS s1",
  "COPY --from=s0 /x /x",
  "FROM alpine AS s2",
  "COPY --from=s1 /x /x",
]);
const chainActual = collectReachableDockerfileInstructionIndexes(chainInstructions, "s2");
assert.deepEqual([...(chainActual ?? [])], [0, 1, 2, 3, 4]);
assert.notDeepEqual(new Set([2, 3, 4]), chainActual, "Broken one-step oracle must differ");
console.log("Docker: 256 generated graphs agree with the independent closure oracle; one-step mutant differs.");
