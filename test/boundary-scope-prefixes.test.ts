import { describe, expect, test } from "bun:test";

function shouldSkipFinding(scopePrefixes: string[]): boolean {
  return scopePrefixes.length === 0 || scopePrefixes.length > 3;
}

describe("scopePrefixes.length boundary BVA", () => {
  test.each([
    [true, []],
    [false, ["src"]],
    [false, ["src", "lib"]],
    [false, ["src", "lib", "app"]],
    [true, ["src", "lib", "app", "test"]],
    [true, Array.from({ length: 10 }, (_, i) => `p${i}`)],
  ] as const)("returns %p for %p", (expected, scopePrefixes) => {
    expect(shouldSkipFinding([...scopePrefixes])).toBe(expected);
  });
});

function countCheckoutSteps(steps: { uses?: string }[]): number {
  return steps.filter((step) => (step.uses ?? "").startsWith("actions/checkout@")).length;
}

describe("countCheckoutSteps >= 2 boundary", () => {
  test.each([
    [0, []],
    [0, [{}]],
    [0, [{ uses: "some/action@" }]],
    [1, [{ uses: "actions/checkout@v4" }]],
    [2, [{ uses: "actions/checkout@v4" }, { uses: "actions/checkout@v4" }]],
    [
      3,
      [
        { uses: "actions/checkout@v4" },
        { uses: "actions/checkout@v4" },
        { uses: "actions/checkout@v4" },
      ],
    ],
  ] as const)("%p checkouts", (expected, steps) => {
    expect(countCheckoutSteps([...steps])).toBe(expected);
  });
});
