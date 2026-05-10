import { describe, expect, test } from "bun:test";
import {
  pipe,
  taggedPipe,
  identityDiagnosticTransform,
  getDiagnosticTransformMetadata,
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
