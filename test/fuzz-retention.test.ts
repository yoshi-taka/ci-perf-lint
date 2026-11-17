import { expect, test } from "bun:test";
import { Rng, mutate } from "../src/fuzz/mutator.ts";
import { retainCoverage } from "../src/fuzz/retention.ts";

test("retains only inputs that add coverage", () => {
  const first = retainCoverage(new Set(), ["a", "b"]);
  expect(first.fresh).toBe(true);
  expect([...first.seen]).toEqual(["a", "b"]);
  const duplicate = retainCoverage(first.seen, ["a", "b"]);
  expect(duplicate.fresh).toBe(false);
  expect([...duplicate.seen]).toEqual(["a", "b"]);
  const extension = retainCoverage(first.seen, ["b", "c"]);
  expect(extension.fresh).toBe(true);
  expect([...extension.seen]).toEqual(["a", "b", "c"]);
});

test("mutations stay bounded, change the input, and are deterministic", () => {
  const seed = Buffer.from("on: push\njobs: {}\n", "utf8");
  const first = new Rng(42);
  const second = new Rng(42);
  for (let index = 0; index < 200; index += 1) {
    const a = mutate(seed, first, [seed], 256);
    const b = mutate(seed, second, [seed], 256);
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(256);
  }
});
