export type GateExpr<G extends string = string> =
  | { readonly kind: "atom"; readonly gate: G }
  | { readonly kind: "and"; readonly left: GateExpr<G>; readonly right: GateExpr<G> }
  | { readonly kind: "or"; readonly left: GateExpr<G>; readonly right: GateExpr<G> };

export function atom<G extends string>(gate: G): GateExpr<G> {
  return { kind: "atom", gate };
}

export function andExpr<G extends string>(left: GateExpr<G>, right: GateExpr<G>): GateExpr<G> {
  return { kind: "and", left, right };
}

export function orExpr<G extends string>(left: GateExpr<G>, right: GateExpr<G>): GateExpr<G> {
  return { kind: "or", left, right };
}

export type GateState<G extends string> = Partial<Record<G, boolean>>;

export function evaluateGateExpr<G extends string>(
  expr: GateExpr<G>,
  state: GateState<G>,
): boolean {
  switch (expr.kind) {
    case "atom":
      return state[expr.gate] ?? false;
    case "and":
      return evaluateGateExpr(expr.left, state) && evaluateGateExpr(expr.right, state);
    case "or":
      return evaluateGateExpr(expr.left, state) || evaluateGateExpr(expr.right, state);
  }
}

export function collectGates<G extends string>(expr: GateExpr<G>): Set<G> {
  const gates = new Set<G>();

  function walk(e: GateExpr<G>): void {
    switch (e.kind) {
      case "atom":
        gates.add(e.gate);
        break;
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        break;
    }
  }

  walk(expr);
  return gates;
}

export function flattenAnd<G extends string>(expr: GateExpr<G>): GateExpr<G> {
  switch (expr.kind) {
    case "atom":
      return expr;
    case "and": {
      const left = flattenAnd(expr.left);
      const right = flattenAnd(expr.right);
      const children: GateExpr<G>[] = [];
      for (const child of [left, right]) {
        if (child.kind === "and") {
          children.push(child.left, child.right);
        } else {
          children.push(child);
        }
      }
      return children.reduce((acc, c) => andExpr(acc, c));
    }
    case "or":
      return orExpr(flattenAnd(expr.left), flattenAnd(expr.right));
  }
}

export function flattenOr<G extends string>(expr: GateExpr<G>): GateExpr<G> {
  switch (expr.kind) {
    case "atom":
      return expr;
    case "or": {
      const left = flattenOr(expr.left);
      const right = flattenOr(expr.right);
      const children: GateExpr<G>[] = [];
      for (const child of [left, right]) {
        if (child.kind === "or") {
          children.push(child.left, child.right);
        } else {
          children.push(child);
        }
      }
      return children.reduce((acc, c) => orExpr(acc, c));
    }
    case "and":
      return andExpr(flattenOr(expr.left), flattenOr(expr.right));
  }
}

function gatesEqual<G extends string>(a: GateExpr<G>, b: GateExpr<G>): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "atom" && b.kind === "atom") {
    return a.gate === b.gate;
  }
  if (a.kind === "and" && b.kind === "and") {
    return gatesEqual(a.left, b.left) && gatesEqual(a.right, b.right);
  }
  if (a.kind === "or" && b.kind === "or") {
    return gatesEqual(a.left, b.left) && gatesEqual(a.right, b.right);
  }
  return false;
}

export function simplifyGateExpr<G extends string>(expr: GateExpr<G>): GateExpr<G> {
  switch (expr.kind) {
    case "atom":
      return expr;
    case "and": {
      const left = simplifyGateExpr(expr.left);
      const right = simplifyGateExpr(expr.right);
      if (gatesEqual(left, right)) {
        return left;
      }
      return andExpr(left, right);
    }
    case "or": {
      const left = simplifyGateExpr(expr.left);
      const right = simplifyGateExpr(expr.right);
      if (gatesEqual(left, right)) {
        return left;
      }
      return orExpr(left, right);
    }
  }
}

export function gateExprFromLegacy<G extends string>(
  gate?: G,
  gates?: readonly G[],
): GateExpr<G> | undefined {
  if (gates && gates.length > 0) {
    const atoms = gates.map((g) => atom(g));
    return atoms.reduce((acc, a) => andExpr(acc, a));
  }
  if (gate) {
    return atom(gate);
  }
  return undefined;
}
