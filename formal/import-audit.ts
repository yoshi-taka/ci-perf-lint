/** Optional Bun + Z3/WASM verification. Not a product or default-CI dependency.
 * Model scope: post-parse Boolean facts, nonnegative counts, bounded graphs.
 * AST coverage and resolver/scope correctness are not generally proved here.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool } from "z3-solver";
import {
  importAuditDecisions,
  type ImportAuditInput,
} from "../src/repository-diagnostics/source-import-policy.ts";
import {
  exceedsSourceLimit,
  MAX_BARREL_SOURCES,
  MAX_INLINE_SNAPSHOT_LINES,
  MAX_EXTERNAL_SNAPSHOT_LINES,
} from "../src/repository-diagnostics/source-size-policy.ts";
import { parseSourceAudit } from "../src/repository-diagnostics/source-audit-parser.ts";
import { findLargeBarrels } from "../src/repository-diagnostics/source-barrel-graph.ts";

const api = await init();
try {
  const context = new api.Context("audit");
  const { Bool, Int, Solver } = context;
  const And = context.And.bind(context),
    Or = context.Or.bind(context),
    Not = context.Not.bind(context),
    Xor = context.Xor.bind(context),
    isTrue = context.isTrue.bind(context);
  const solver = new Solver();
  solver.set("timeout", 10_000);
  async function check(formula: Z3Bool<"audit">, expected: "sat" | "unsat") {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(
      actual,
      expected,
      `Expected ${expected}; got ${actual}${actual === "unknown" ? ` (${solver.reasonUnknown()})` : ""}: ${formula.sexpr()}`,
    );
  }
  const variables = {
    runtime: Bool.const("runtime"),
    hasBindings: Bool.const("hasBindings"),
    relative: Bool.const("relative"),
    hasExtension: Bool.const("hasExtension"),
    hasQuery: Bool.const("hasQuery"),
    restrictedSuppressed: Bool.const("restrictedSuppressed"),
    extensionsSuppressed: Bool.const("extensionsSuppressed"),
  };
  const v = variables;
  const restricted = And(v.runtime, v.hasBindings, Not(v.restrictedSuppressed));
  const extensions = And(
    v.runtime,
    v.relative,
    Not(v.hasExtension),
    Not(v.hasQuery),
    Not(v.extensionsSuppressed),
  );
  await check(And(restricted, extensions), "sat");
  await check(And(extensions, Not(v.hasBindings)), "sat");
  await check(And(Not(v.runtime), Or(restricted, extensions)), "unsat");
  await check(And(v.restrictedSuppressed, restricted), "unsat");
  await check(And(v.extensionsSuppressed, extensions), "unsat");
  await check(And(extensions, Or(Not(v.relative), v.hasExtension, v.hasQuery)), "unsat");
  await check(And(v.restrictedSuppressed, extensions), "sat");
  await check(And(v.extensionsSuppressed, restricted), "sat");
  // Deliberately broken models must yield counterexamples, not vacuous success.
  await check(Xor(restricted, And(v.hasBindings, Not(v.restrictedSuppressed))), "sat");
  await check(Xor(extensions, And(extensions, Not(v.restrictedSuppressed))), "sat");
  const names = Object.keys(variables) as (keyof ImportAuditInput)[];
  for (let bits = 0; bits < 128; bits++) {
    const input = Object.fromEntries(
      names.map((name, index) => [name, Boolean(bits & (1 << index))]),
    ) as unknown as ImportAuditInput;
    await check(And(...names.map((name) => variables[name].eq(input[name]))), "sat");
    const model = solver.model();
    assert.deepEqual(
      importAuditDecisions(input),
      {
        restricted: isTrue(model.eval(restricted, true)),
        extensions: isTrue(model.eval(extensions, true)),
      },
      JSON.stringify(input),
    );
  }
  console.log(
    "Z3 eligibility properties + intentional mutants passed; current TS matches all 128 Boolean inputs.",
  );

  const count = Int.const("count"),
    limit = Int.const("limit"),
    larger = Int.const("larger");
  const large = count.gt(limit);
  await check(And(count.ge(0), limit.ge(0), count.le(limit), large), "unsat");
  await check(And(count.ge(0), limit.ge(0), count.gt(limit), Not(large)), "unsat");
  await check(
    And(count.ge(0), limit.ge(0), larger.ge(count), large, Not(larger.gt(limit))),
    "unsat",
  );
  await check(And(count.ge(0), limit.ge(0), Xor(large, count.ge(limit))), "sat");
  assert.deepEqual(
    [MAX_BARREL_SOURCES, MAX_INLINE_SNAPSHOT_LINES, MAX_EXTERNAL_SNAPSHOT_LINES],
    [100, 50, 300],
  );
  for (const threshold of [100, 50, 300]) {
    for (let n = 0; n <= 301; n++) {
      assert.equal(exceedsSourceLimit(n, threshold), n > threshold);
    }
  }
  console.log(
    "Z3 threshold/monotonicity + >= mutation checks passed; current TS matches 906 size inputs.",
  );

  // All 512 directed three-node graphs; root has 99 fixed external leaves.
  // Count unique reachable references, not edges, and exclude the root.
  const edges = Array.from({ length: 9 }, (_, index) => Bool.const(`edge_${index}`));
  let reachable = [Bool.val(true), Bool.val(false), Bool.val(false)];
  for (let step = 0; step < 3; step++) {
    reachable = Array.from({ length: 3 }, (_row, j) =>
      Or(
        reachable[j]!,
        ...Array.from({ length: 3 }, (_column, i) => And(reachable[i]!, edges[i * 3 + j]!)),
      ),
    );
  }
  const graphLarge = And(reachable[1]!, reachable[2]!);
  await check(graphLarge, "sat");
  await check(And(Not(Or(edges[1]!, edges[2]!)), graphLarge), "unsat");
  const cycle = [false, true, false, true, false, false, false, false, false];
  await check(And(...edges.map((edge, index) => edge.eq(cycle[index]!)), graphLarge), "unsat");
  const files = new Set(["n0.ts", "n1.ts", "n2.ts"]);
  for (let bits = 0; bits < 512; bits++) {
    const values = edges.map((_, index) => Boolean(bits & (1 << index)));
    await check(And(...edges.map((edge, index) => edge.eq(values[index]!))), "sat");
    const expected = isTrue(solver.model().eval(graphLarge, true));
    const parsed = [];
    for (let i = 0; i < 3; i++) {
      const lines =
        i === 0 ? Array.from({ length: 99 }, (_, n) => `export * from "external-${n}";`) : [];
      for (let j = 0; j < 3; j++) {
        if (values[i * 3 + j]) {
          lines.push(i === 0 ? `export * from "./n${j}";` : `import "./n${j}";`);
        }
      }
      const facts = await parseSourceAudit(`n${i}.ts`, lines.join("\n"));
      assert.ok(facts, "Invalid generated graph source");
      parsed.push(facts);
    }
    const actual = findLargeBarrels(
      parsed.flatMap((facts) => facts.imports),
      parsed.flatMap((facts) => facts.wildcardExports),
      files,
    ).some((f) => f.relativePath === "n0.ts");
    assert.equal(actual, expected, JSON.stringify({ graph: values, expected, actual }));
  }
  console.log(
    "Z3 reachability matches actual AST + barrel traversal on all 512 three-node graphs (bounded evidence).",
  );
} finally {
  await killThreads(api.em);
}
