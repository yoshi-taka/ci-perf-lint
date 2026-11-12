import { deepStrictEqual, equal } from "node:assert/strict";
import { formalRunner } from "./formal-runtime.ts";
import {
  collectorRequiresAllGatesFromResults,
  type GateKey,
  type GateResult,
  type GateResultRecord,
} from "../src/repository-diagnostics/collector-types.ts";
import {
  evaluateGateExpr,
  evaluateGateExprWithTrace,
  flattenAnd,
  flattenOr,
  gateExprFromLegacy,
  simplifyGateExpr,
  type GateExpr,
} from "../src/repository-diagnostics/gate-expr.ts";
import { gateKeys } from "../src/repository-diagnostics/gates.ts";

type ExpressionCase = {
  kind: "expression";
  results: GateResult[];
  expr: GateExpr<GateKey>;
  result: GateResult;
  simplified: GateExpr<GateKey>;
  flattenedAnd: GateExpr<GateKey>;
  flattenedOr: GateExpr<GateKey>;
};
type LegacyCase = {
  kind: "legacy";
  results: GateResult[];
  gates: GateKey[];
  result: GateResult;
};

const output = await formalRunner.run("GateExpr");

const nodes = [gateKeys.rust, gateKeys.gradle, gateKeys.javascriptTooling] as const;
let expressions = 0;
let legacy = 0;
let booleanCases = 0;
const seen = new Set<string>();
for (const line of output.split("\n")) {
  if (!line.startsWith("{")) {
    continue;
  }
  const item = JSON.parse(line) as ExpressionCase | LegacyCase;
  equal(item.results.length, 3);
  const key = JSON.stringify([
    item.kind,
    item.results,
    item.kind === "expression" ? item.expr : item.gates,
  ]);
  equal(seen.has(key), false, `Duplicate case: ${key}`);
  seen.add(key);
  const results = Object.fromEntries(
    Object.values(gateKeys).map((gate) => [gate, { status: "skipped", reason: "unused" }]),
  ) as GateResultRecord;
  for (const [i, node] of nodes.entries()) {
    results[node] = item.results[i]!;
  }
  if (item.kind === "legacy") {
    deepStrictEqual(
      collectorRequiresAllGatesFromResults({ gates: item.gates }, results),
      item.result,
      key,
    );
    const expr = gateExprFromLegacy(undefined, item.gates);
    deepStrictEqual(
      collectorRequiresAllGatesFromResults(expr ? { gateExpr: expr } : {}, results),
      item.result,
      key,
    );
    legacy++;
    continue;
  }
  const evaluate = (expr: GateExpr<GateKey>) =>
    collectorRequiresAllGatesFromResults({ gateExpr: expr }, results);
  deepStrictEqual(evaluate(item.expr), item.result, key);
  const transforms = [
    [simplifyGateExpr(item.expr), item.simplified],
    [flattenAnd(item.expr), item.flattenedAnd],
    [flattenOr(item.expr), item.flattenedOr],
  ] as const;
  for (const [actual, expected] of transforms) {
    deepStrictEqual(actual, expected, `Model/TS AST mismatch: ${key}`);
    deepStrictEqual(evaluate(actual), item.result, `Changed result/reason: ${key}`);
  }
  // Boolean and trace APIs are comparable ONLY for fully resolved assignments.
  if (item.results.every((r) => r.status === "resolved")) {
    const state = Object.fromEntries(
      nodes.map((node) => {
        const r = results[node];
        return [node, r.status === "resolved" && r.value];
      }),
    );
    deepStrictEqual({ status: "resolved", value: evaluateGateExpr(item.expr, state) }, item.result);
    equal(
      evaluateGateExprWithTrace(item.expr, state).finalResult,
      evaluateGateExpr(item.expr, state),
    );
    booleanCases++;
  }
  expressions++;
}
equal(expressions, 418 * 64);
equal(legacy, 121 * 64);
equal(booleanCases, 418 * 8);
console.log(
  `Gate expressions: ${expressions} model/TS/transform cases; ${legacy} legacy cases; ${booleanCases} resolved Boolean/trace cases passed.`,
);
console.log(
  "Ordered unknown/error propagation preserved. Commutation/distribution counterexamples proved; production policy unchanged.",
);
