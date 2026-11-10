import { describe, expect, test } from "bun:test";
import {
  collectorRequiresAllGatesFromResults,
  type GateKey,
  type GateResult,
  type GateResultRecord,
} from "../src/repository-diagnostics/collector-types.ts";
import {
  andExpr,
  atom,
  notExpr,
  orExpr,
  simplifyGateExpr,
  flattenAnd,
  flattenOr,
  type GateExpr,
} from "../src/repository-diagnostics/gate-expr.ts";
import { gateKeys } from "../src/repository-diagnostics/gates.ts";

const a = atom(gateKeys.rust);
const b = atom(gateKeys.gradle);
const c = atom(gateKeys.javascriptTooling);
const variants: readonly [GateResult, GateResult, GateResult, GateResult] = [
  { status: "resolved", value: false },
  { status: "resolved", value: true },
  { status: "skipped", reason: "unknown 日本語" },
  { status: "error", reason: "failure" },
];

function makeResults(left: GateResult, right: GateResult, third: GateResult = variants[0]) {
  const results = Object.fromEntries(
    Object.values(gateKeys).map((gate) => [gate, { status: "skipped", reason: "unused" }]),
  ) as GateResultRecord;
  results.hasRust = left;
  results.hasGradle = right;
  results.hasJavaScriptTooling = third;
  return results;
}

function evaluate(expr: GateExpr<GateKey>, results: GateResultRecord) {
  return collectorRequiresAllGatesFromResults({ gateExpr: expr }, results);
}

describe("ordered gate result semantics", () => {
  test("exhausts the result table, preserving leftmost unknown/error reasons", () => {
    for (const left of variants) {
      for (const right of variants) {
        const results = makeResults(left, right);
        const expectedAnd = left.status !== "resolved" ? left : left.value ? right : left;
        const expectedOr = left.status !== "resolved" ? left : left.value ? left : right;
        expect(evaluate(andExpr(a, b), results)).toEqual(expectedAnd);
        expect(evaluate(orExpr(a, b), results)).toEqual(expectedOr);
        expect(evaluate(notExpr(a), results)).toEqual(
          left.status === "resolved" ? { status: "resolved", value: !left.value } : left,
        );
      }
    }
  });

  test("commuting and distributing are not valid rewrites for this policy", () => {
    const results = makeResults(variants[2], variants[1]);
    expect(evaluate(orExpr(a, b), results)).toEqual(variants[2]);
    expect(evaluate(orExpr(b, a), results)).toEqual(variants[1]);
    const distribution = makeResults(variants[1], variants[3], variants[0]);
    expect(evaluate(andExpr(orExpr(a, b), c), distribution)).toEqual(variants[0]);
    expect(evaluate(orExpr(andExpr(a, c), andExpr(b, c)), distribution)).toEqual(variants[3]);
  });

  test("distinct unknown/error reasons retain left-to-right provenance", () => {
    for (const status of ["skipped", "error"] as const) {
      const left: GateResult = { status, reason: "left 日本語" };
      const right: GateResult = { status, reason: "right" };
      const results = makeResults(left, right);
      expect(evaluate(andExpr(a, b), results)).toEqual(left);
      expect(evaluate(orExpr(a, b), results)).toEqual(left);
      expect(evaluate(andExpr(b, a), results)).toEqual(right);
      expect(evaluate(orExpr(b, a), results)).toEqual(right);
    }
  });

  test("simplification and regrouping preserve exact results on nested expressions", () => {
    const expressions = [
      andExpr(andExpr(a, b), andExpr(a, b)),
      orExpr(orExpr(a, b), orExpr(a, b)),
      notExpr(notExpr(andExpr(a, b))),
      notExpr(andExpr(a, orExpr(b, notExpr(c)))),
    ];
    for (const left of variants) {
      for (const right of variants) {
        for (const third of variants) {
          const results = makeResults(left, right, third);
          for (const expr of expressions) {
            const expected = evaluate(expr, results);
            for (const transform of [simplifyGateExpr, flattenAnd, flattenOr]) {
              expect(evaluate(transform(expr), results)).toEqual(expected);
            }
          }
        }
      }
    }
  });

  test("AND/OR do not read the right gate after a decisive or unresolved left gate", () => {
    for (const left of variants) {
      const reads: string[] = [];
      const results = new Proxy(makeResults(left, variants[0]), {
        get(target, key: string) {
          reads.push(key);
          return target[key as GateKey];
        },
      });
      evaluate(andExpr(a, b), results);
      expect(reads).toEqual(
        left.status === "resolved" && left.value
          ? [gateKeys.rust, gateKeys.gradle]
          : [gateKeys.rust],
      );
      reads.length = 0;
      evaluate(orExpr(a, b), results);
      expect(reads).toEqual(
        left.status === "resolved" && !left.value
          ? [gateKeys.rust, gateKeys.gradle]
          : [gateKeys.rust],
      );
    }
  });

  test("legacy precedence and empty arrays remain consistent with the API", () => {
    const results = makeResults(variants[0], variants[1]);
    expect(
      collectorRequiresAllGatesFromResults(
        { gateExpr: b, gate: gateKeys.rust, gates: [gateKeys.rust] },
        results,
      ),
    ).toEqual(variants[1]);
    expect(
      collectorRequiresAllGatesFromResults(
        { gate: gateKeys.rust, gates: [gateKeys.gradle] },
        results,
      ),
    ).toEqual(variants[1]);
    expect(
      collectorRequiresAllGatesFromResults({ gate: gateKeys.rust, gates: [] }, results),
    ).toEqual(variants[0]);
    expect(collectorRequiresAllGatesFromResults({ gates: [] }, results)).toEqual(variants[1]);
  });
});
