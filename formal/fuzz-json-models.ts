/** Optional Bun + Z3 bridge for the fuzz-target JSON guard.
 *
 * Scope: the value classes that `JSON.parse` can return. Z3 proves the class
 * partition and that the guard accepts exactly objects; the concrete table
 * checks `parseJsonObject` on real JSON literals. Non-JSON values, prototypes
 * and accessors are outside the model.
 *
 * Not a product or default-CI dependency.
 */
import assert from "node:assert/strict";
import { init, killThreads, type Bool as Z3Bool } from "z3-solver";
import { isJsonObject, parseJsonObject } from "../src/fuzz/json.ts";

const api = await init();
try {
  const context = new api.Context("fuzz-json");
  const { Bool, Solver, And, Or, Not, Xor } = context;
  const solver = new Solver();
  solver.set("timeout", 10_000);

  function allOf(terms: Z3Bool<"fuzz-json">[]): Z3Bool<"fuzz-json"> {
    return terms.reduce((left, right) => And(left, right));
  }
  function anyOf(terms: Z3Bool<"fuzz-json">[]): Z3Bool<"fuzz-json"> {
    return terms.reduce((left, right) => Or(left, right));
  }
  async function check(
    formula: Z3Bool<"fuzz-json">,
    expected: "sat" | "unsat",
    label: string,
  ): Promise<void> {
    solver.reset();
    solver.add(formula);
    const actual = await solver.check();
    assert.equal(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  }

  const isNull = Bool.const("isNull");
  const isArray = Bool.const("isArray");
  const isObject = Bool.const("isObject");
  const isPrimitive = Bool.const("isPrimitive");
  const classes = [isNull, isArray, isObject, isPrimitive];

  // Exactly one value class holds for any parsed JSON value.
  const partition = allOf([
    anyOf(classes),
    ...classes.flatMap((left, index) =>
      classes.slice(index + 1).map((right) => Not(And(left, right))),
    ),
  ]);

  // `typeof value === "object" && value !== null && !Array.isArray(value)`
  const accepted = allOf([isObject, Not(isNull), Not(isArray), Not(isPrimitive)]);

  await check(
    allOf([partition, accepted, Not(isObject)]),
    "unsat",
    "accepted value is always an object",
  );
  await check(
    allOf([partition, isObject, Not(accepted)]),
    "unsat",
    "every object is accepted",
  );
  await check(
    allOf([partition, accepted, Not(isObject)]),
    "unsat",
    "no non-object is accepted",
  );
  await check(
    allOf([partition, Not(anyOf(classes))]),
    "unsat",
    "the value classes cover every parsed value",
  );
  await check(
    allOf([partition, Xor(accepted, isObject)]),
    "unsat",
    "acceptance is equivalent to object-ness",
  );

  // Positive controls: each broken guard must produce a counterexample.
  const brokenNullCheck = allOf([Not(isArray)]);
  await check(
    allOf([partition, brokenNullCheck, Not(isObject)]),
    "sat",
    "missing null check accepts null or primitives",
  );

  const shallowTypeofGuard = anyOf([isObject, isNull, isArray]);
  await check(
    allOf([partition, shallowTypeofGuard, Not(isObject)]),
    "sat",
    "typeof-only guard accepts null or arrays",
  );

  const acceptEverything = anyOf([isNull, Not(isNull)]);
  await check(
    allOf([partition, acceptEverything, Not(isObject)]),
    "sat",
    "unconditional guard accepts non-objects",
  );

  const samples: { text: string; object: boolean }[] = [
    { text: "null", object: false },
    { text: "true", object: false },
    { text: "false", object: false },
    { text: "0", object: false },
    { text: "-1.5", object: false },
    { text: "1e3", object: false },
    { text: '""', object: false },
    { text: '"x"', object: false },
    { text: "[]", object: false },
    { text: "[1,null]", object: false },
    { text: "[[{}]]", object: false },
    { text: "{}", object: true },
    { text: '{"findings":[]}', object: true },
    { text: '{"a":{"b":null}}', object: true },
  ];
  for (const sample of samples) {
    const text = sample.text;
    assert.equal(
      isJsonObject(JSON.parse(text)),
      sample.object,
      `isJsonObject(${sample.text})`,
    );
    const parsed = parseJsonObject(text);
    assert.equal(
      parsed !== undefined,
      sample.object,
      `parseJsonObject(${sample.text})`,
    );
    if (parsed === undefined) {
      continue;
    }
    assert.equal(typeof parsed, "object");
    assert.notEqual(parsed, null);
    assert.ok(!Array.isArray(parsed));
    assert.doesNotThrow(() => parsed.findings);
  }

  for (const invalid of ["", "undefined", "{", "nul", '{"a":}', "[1,]"]) {
    assert.equal(parseJsonObject(invalid), undefined, `invalid JSON ${invalid}`);
  }

  console.log("[z3] json guard accepts exactly JSON objects");
} finally {
  await killThreads(api.em);
}
