import { describe, expect, test } from "bun:test";
import {
  atom,
  andExpr,
  orExpr,
  evaluateGateExpr,
  collectGates,
  flattenAnd,
  flattenOr,
  simplifyGateExpr,
  gateExprFromLegacy,
} from "../src/repository-diagnostics/gate-expr.ts";

describe("GateExpr construction", () => {
  test("atom", () => {
    const e = atom("hasDockerHeavyWorkflow");
    expect(e).toEqual({ kind: "atom", gate: "hasDockerHeavyWorkflow" });
  });

  test("and", () => {
    const e = andExpr(atom("a"), atom("b"));
    expect(e).toEqual({
      kind: "and",
      left: { kind: "atom", gate: "a" },
      right: { kind: "atom", gate: "b" },
    });
  });

  test("or", () => {
    const e = orExpr(atom("a"), atom("b"));
    expect(e.kind).toBe("or");
  });
});

describe("evaluateGateExpr", () => {
  const state: Record<string, boolean> = { a: true, b: false, c: true };

  test("atom true", () => {
    expect(evaluateGateExpr(atom("a"), state)).toBe(true);
  });

  test("atom false", () => {
    expect(evaluateGateExpr(atom("b"), state)).toBe(false);
  });

  test("atom missing returns false", () => {
    expect(evaluateGateExpr(atom("x"), state)).toBe(false);
  });

  test("and true", () => {
    expect(evaluateGateExpr(andExpr(atom("a"), atom("c")), state)).toBe(true);
  });

  test("and false", () => {
    expect(evaluateGateExpr(andExpr(atom("a"), atom("b")), state)).toBe(false);
  });

  test("or true", () => {
    expect(evaluateGateExpr(orExpr(atom("a"), atom("b")), state)).toBe(true);
  });

  test("or false", () => {
    expect(evaluateGateExpr(orExpr(atom("b"), atom("b")), state)).toBe(false);
  });

  test("nested and/or", () => {
    const expr = andExpr(orExpr(atom("a"), atom("b")), atom("c"));
    expect(evaluateGateExpr(expr, state)).toBe(true);
  });

  test("nested and/or false", () => {
    const expr = andExpr(orExpr(atom("b"), atom("b")), atom("c"));
    expect(evaluateGateExpr(expr, state)).toBe(false);
  });
});

describe("collectGates", () => {
  test("single atom", () => {
    expect([...collectGates(atom("a"))]).toEqual(["a"]);
  });

  test("and collects both", () => {
    const gates = collectGates(andExpr(atom("a"), atom("b")));
    expect([...gates].sort()).toEqual(["a", "b"]);
  });

  test("deduplicates repeated gates", () => {
    const gates = collectGates(andExpr(atom("a"), atom("a")));
    expect([...gates]).toEqual(["a"]);
  });

  test("nested expression", () => {
    const gates = collectGates(andExpr(orExpr(atom("a"), atom("b")), atom("c")));
    expect([...gates].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("flattenAnd", () => {
  test("flat and (and a (and b c)) -> and a b c nested left", () => {
    const expr = andExpr(atom("a"), andExpr(atom("b"), atom("c")));
    const flat = flattenAnd(expr);
    expect(flat.kind).toBe("and");
    if (flat.kind === "and") {
      expect(flat.left.kind === "and");
    }
  });

  test("atom unchanged", () => {
    expect(flattenAnd(atom("a"))).toEqual(atom("a"));
  });
});

describe("flattenOr", () => {
  test("or chain flattened", () => {
    const expr = orExpr(atom("a"), orExpr(atom("b"), atom("c")));
    const flat = flattenOr(expr);
    expect(flat.kind).toBe("or");
  });

  test("atom unchanged", () => {
    expect(flattenOr(atom("a"))).toEqual(atom("a"));
  });
});

describe("simplifyGateExpr", () => {
  test("and same -> atom", () => {
    const expr = andExpr(atom("a"), atom("a"));
    const simplified = simplifyGateExpr(expr);
    expect(simplified).toEqual(atom("a"));
  });

  test("or same -> atom", () => {
    const expr = orExpr(atom("a"), atom("a"));
    const simplified = simplifyGateExpr(expr);
    expect(simplified).toEqual(atom("a"));
  });

  test("and different kept", () => {
    const expr = andExpr(atom("a"), atom("b"));
    const simplified = simplifyGateExpr(expr);
    expect(simplified.kind).toBe("and");
  });

  test("atom unchanged", () => {
    expect(simplifyGateExpr(atom("a"))).toEqual(atom("a"));
  });
});

describe("gateExprFromLegacy", () => {
  test("gate only", () => {
    const expr = gateExprFromLegacy("a");
    expect(expr).toEqual(atom("a"));
  });

  test("gates array", () => {
    const expr = gateExprFromLegacy(undefined, ["a", "b"]);
    expect(expr).toBeDefined();
    expect(expr!.kind).toBe("and");
  });

  test("single gate array", () => {
    const expr = gateExprFromLegacy(undefined, ["a"]);
    expect(expr).toEqual(atom("a"));
  });

  test("no gates", () => {
    expect(gateExprFromLegacy()).toBeUndefined();
  });

  test("gates takes precedence over gate (legacy compatibility)", () => {
    const expr = gateExprFromLegacy("a", ["b", "c"]);
    // gates is used when provided, gate is fallback
    expect(expr).toEqual(andExpr(atom("b"), atom("c")));
  });
});
