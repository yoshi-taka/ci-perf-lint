import { describe, expect, test, beforeEach } from "bun:test";
import {
  pipe,
  taggedPipe,
  identityDiagnosticTransform,
  getDiagnosticTransformMetadata,
  hasAppliedTransform,
  markTransformApplied,
  getAppliedTransformLabels,
  resetTransformTracking,
  type TaggedTransform,
} from "../src/rules/shared/diagnostic-transform.ts";
import type { Diagnostic } from "../src/types.ts";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    ruleId: "test-rule",
    severity: "warning",
    confidence: "high",
    docsPath: "docs/rules/test.md",
    workflow: "wf.yml",
    location: { path: "wf.yml", line: 1, column: 1 },
    message: "msg",
    why: "why",
    suggestion: "suggest",
    measurementHint: "measure",
    aiHandoff: "handoff",
    score: 10,
    ...overrides,
  };
}

describe("DiagnosticTransform monoid", () => {
  test("empty pipe is identity", () => {
    const id = pipe();
    const input = diagnostic();

    expect(id.isIdentity).toBe(true);
    expect(id.transforms).toEqual([]);
    expect(id(input)).toBe(input);
  });

  test("identity transforms are optimized away", () => {
    const bumpScore = (d: Diagnostic): Diagnostic => ({ ...d, score: d.score + 2 });
    const transform = pipe(identityDiagnosticTransform, bumpScore, identityDiagnosticTransform);
    const input = diagnostic();

    expect(transform.isIdentity).toBe(false);
    expect(transform.transforms).toHaveLength(1);
    expect(transform(input)).toEqual({ ...input, score: 12 });
  });

  test("composition is associative", () => {
    const a = (d: Diagnostic): Diagnostic => ({ ...d, score: d.score + 1 });
    const b = (d: Diagnostic): Diagnostic => ({ ...d, why: `${d.why} b` });
    const c = (d: Diagnostic): Diagnostic => ({ ...d, aiHandoff: `${d.aiHandoff} c` });

    const left = pipe(a, pipe(b, c));
    const right = pipe(pipe(a, b), c);
    const direct = pipe(a, b, c);
    const input = diagnostic();

    expect(left(input)).toEqual(right(input));
    expect(right(input)).toEqual(direct(input));
  });

  test("tagged pipe stays introspectable with empty composition", () => {
    const transform = taggedPipe();

    expect(transform.isIdentity).toBe(true);
    expect(transform.transforms).toEqual([]);
    expect(transform.axes).toEqual([]);
    expect(transform.labels).toEqual([]);
  });

  test("tagged pipe preserves labels and axes", () => {
    const bump: TaggedTransform = {
      transform: (d) => ({ ...d, score: d.score + 1 }),
      axes: ["score"],
      label: "bump",
    };
    const explain: TaggedTransform = {
      transform: (d) => ({ ...d, why: `${d.why} extra` }),
      axes: ["why"],
      label: "explain",
    };

    const composed = taggedPipe(bump, explain);

    expect(composed.isIdentity).toBe(false);
    expect(composed.transforms).toHaveLength(2);
    expect(composed.axes).toEqual(["score", "why"]);
    expect(composed.labels).toEqual(["bump", "explain"]);
  });
});

describe("idempotent transform safety", () => {
  beforeEach(() => {
    resetTransformTracking();
  });

  test("hasAppliedTransform returns false for non-applied transform", () => {
    const d = diagnostic();
    expect(hasAppliedTransform(d, "test-transform")).toBe(false);
  });

  test("markTransformApplied records label", () => {
    const d = diagnostic();
    markTransformApplied(d, "bump");
    expect(hasAppliedTransform(d, "bump")).toBe(true);
    expect(getAppliedTransformLabels(d)).toEqual(["bump"]);
  });

  test("multiple labels are tracked independently", () => {
    const d = diagnostic();
    markTransformApplied(d, "a");
    markTransformApplied(d, "b");
    expect(hasAppliedTransform(d, "a")).toBe(true);
    expect(hasAppliedTransform(d, "b")).toBe(true);
    expect([...getAppliedTransformLabels(d)].sort()).toEqual(["a", "b"]);
  });

  test("resetTransformTracking clears all labels", () => {
    const d = diagnostic();
    markTransformApplied(d, "a");
    expect(hasAppliedTransform(d, "a")).toBe(true);
    resetTransformTracking();
    expect(hasAppliedTransform(d, "a")).toBe(false);
  });

  test("tagged pipe skips already-applied transforms", () => {
    let bumpCallCount = 0;
    const bump: TaggedTransform = {
      transform: (d) => {
        bumpCallCount++;
        return { ...d, score: d.score + 5 };
      },
      axes: ["score"],
      label: "bump",
    };
    const composed = taggedPipe(bump);

    const d = diagnostic({ score: 10 });
    const first = composed(d);
    expect(first.score).toBe(15);
    expect(bumpCallCount).toBe(1);

    const second = composed(first);
    expect(second.score).toBe(15);
    expect(bumpCallCount).toBe(1);
  });

  test("tagged pipe with multiple transforms, only unapplied ones execute", () => {
    let aCount = 0;
    let bCount = 0;
    const a: TaggedTransform = {
      transform: (d) => {
        aCount++;
        return { ...d, score: d.score + 1 };
      },
      axes: ["score"],
      label: "a",
    };
    const b: TaggedTransform = {
      transform: (d) => {
        bCount++;
        return { ...d, why: `${d.why} b` };
      },
      axes: ["why"],
      label: "b",
    };
    const composed = taggedPipe(a, b);

    const d = diagnostic({ score: 10, why: "base" });
    const once = composed(d);
    expect(once.score).toBe(11);
    expect(once.why).toBe("base b");
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);

    // re-apply: both already applied → no-op
    const twice = composed(once);
    expect(twice.score).toBe(11);
    expect(twice.why).toBe("base b");
    expect(aCount).toBe(1);
    expect(bCount).toBe(1);
  });

  test("non-identical-result transform still idempotent-safe", () => {
    const check: TaggedTransform = {
      transform: (d) => ({ ...d, aiHandoff: `${d.aiHandoff} checked` }),
      axes: ["aiHandoff"],
      label: "check",
    };
    const composed = taggedPipe(check);

    const d = diagnostic({ aiHandoff: "init" });
    const once = composed(d);
    expect(once.aiHandoff).toBe("init checked");

    // second application should skip (transform already applied)
    const twice = composed(once);
    expect(twice.aiHandoff).toBe("init checked");
  });

  test("idempotency test helper: T(D) === T(T(D)) for new transforms", () => {
    const d = diagnostic({ score: 10 });

    // A transform that properly marks itself as applied via tag
    const bump: TaggedTransform = {
      transform: (diag) => ({ ...diag, score: diag.score + 5 }),
      axes: ["score"],
      label: "bump",
    };
    const composed = taggedPipe(bump);

    // Dev-mode assertion: applying twice should yield same result
    const once = composed(d);
    const twice = composed(once);
    expect(once).toEqual(twice);
  });
});
