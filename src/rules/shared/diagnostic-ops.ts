import type { Diagnostic, Severity } from "../../types.ts";

export type DiagnosticOp =
  | { op: "setSeverity"; severity: Severity }
  | { op: "adjustScore"; delta: number }
  | { op: "setScore"; score: number }
  | { op: "augmentWhy"; text: string; position?: "append" | "prepend" }
  | {
      op: "conditional";
      predicate: (d: Diagnostic) => boolean;
      then: DiagnosticOp[];
      else?: DiagnosticOp[];
    };

function applyOp(d: Diagnostic, op: DiagnosticOp): Diagnostic {
  switch (op.op) {
    case "setSeverity":
      return { ...d, severity: op.severity };
    case "adjustScore":
      return { ...d, score: d.score + op.delta };
    case "setScore":
      return { ...d, score: op.score };
    case "augmentWhy": {
      const separator = d.why.endsWith("\n") ? "" : "\n";
      const text =
        op.position === "prepend" ? op.text + separator + d.why : d.why + separator + op.text;
      return { ...d, why: text };
    }
    case "conditional": {
      if (op.predicate(d)) {
        return applyOps(d, op.then);
      }
      if (op.else) {
        return applyOps(d, op.else);
      }
      return d;
    }
  }
}

export function applyOps(d: Diagnostic, ops: DiagnosticOp[]): Diagnostic {
  let current = d;
  for (const op of ops) {
    current = applyOp(current, op);
  }
  return current;
}
