import { describe, expect, test } from "bun:test";

function makeSignals(overrides: {
  workflowCount?: number;
  heavyWorkflowCount?: number;
  reusableWorkflowJobCount?: number;
  compositeActionCount?: number;
  hasMonorepoMarkers?: boolean;
}) {
  const wc = overrides.workflowCount ?? 0;
  const hwc = overrides.heavyWorkflowCount ?? 0;
  const rjc = overrides.reusableWorkflowJobCount ?? 0;
  const cac = overrides.compositeActionCount ?? 0;
  const mmp = overrides.hasMonorepoMarkers ?? false;

  return {
    primaryWorkflowPath: "test.yml",
    workflowCount: wc,
    heavyWorkflowCount: hwc,
    reusableWorkflowJobCount: rjc,
    compositeActionCount: cac,
    hasMonorepoMarkers: mmp,
    looksLargeOrComplex: wc >= 10 || hwc >= 5 || rjc >= 3 || cac >= 2 || mmp,
  };
}

describe("looksLargeOrComplex boundary", () => {
  describe("workflowCount >= 10", () => {
    test.each([
      [false, 0],
      [false, 9],
      [true, 10],
      [true, 11],
    ] as const)("%p when workflowCount is %p", (expected, workflowCount) => {
      expect(makeSignals({ workflowCount }).looksLargeOrComplex).toBe(expected);
    });
  });

  describe("heavyWorkflowCount >= 5", () => {
    test.each([
      [false, 4],
      [true, 5],
      [true, 6],
    ] as const)("%p when heavyWorkflowCount is %p", (expected, heavyWorkflowCount) => {
      expect(makeSignals({ heavyWorkflowCount }).looksLargeOrComplex).toBe(expected);
    });
  });

  describe("reusableWorkflowJobCount >= 3", () => {
    test.each([
      [false, 2],
      [true, 3],
      [true, 4],
    ] as const)("%p when reusableWorkflowJobCount is %p", (expected, reusableWorkflowJobCount) => {
      expect(makeSignals({ reusableWorkflowJobCount }).looksLargeOrComplex).toBe(expected);
    });
  });

  describe("compositeActionCount >= 2", () => {
    test.each([
      [false, 1],
      [true, 2],
      [true, 3],
    ] as const)("%p when compositeActionCount is %p", (expected, compositeActionCount) => {
      expect(makeSignals({ compositeActionCount }).looksLargeOrComplex).toBe(expected);
    });
  });

  describe("hasMonorepoMarkers", () => {
    test.each([
      ["true regardless of other counts", true, { hasMonorepoMarkers: true, workflowCount: 0 }],
      [
        "false with small counts",
        false,
        { hasMonorepoMarkers: false, workflowCount: 5, heavyWorkflowCount: 2 },
      ],
    ] as const)("%s -> %p", (_name, expected, overrides) => {
      expect(makeSignals(overrides).looksLargeOrComplex).toBe(expected);
    });
  });

  describe("combined conditions (EP)", () => {
    test.each([
      ["all zero", false, {}],
      [
        "exactly one condition met",
        true,
        {
          workflowCount: 10,
          heavyWorkflowCount: 0,
          reusableWorkflowJobCount: 0,
          compositeActionCount: 0,
        },
      ],
      [
        "multiple sub-threshold conditions",
        false,
        {
          workflowCount: 9,
          heavyWorkflowCount: 4,
          reusableWorkflowJobCount: 2,
          compositeActionCount: 1,
        },
      ],
      [
        "all thresholds met",
        true,
        {
          workflowCount: 15,
          heavyWorkflowCount: 8,
          reusableWorkflowJobCount: 5,
          compositeActionCount: 4,
        },
      ],
    ] as const)("%s -> %p", (_name, expected, overrides) => {
      expect(makeSignals(overrides).looksLargeOrComplex).toBe(expected);
    });
  });
});
