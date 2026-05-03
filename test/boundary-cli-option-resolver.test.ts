import { describe, expect, test } from "bun:test";
import {
  resolveOptionFlag,
  similarFlagDistanceLimit,
  levenshteinDistance,
} from "../src/cli-option-resolver.ts";

const knownFlags = [
  "--help",
  "--format",
  "--top",
  "--mode",
  "--findings-only",
  "--workflow-only",
  "--repository-only",
  "--show-workflows",
  "--show-all-locations",
] as const;

describe("similarFlagDistanceLimit BVA", () => {
  test.each([
    ["", 2],
    ["a", 2],
    ["ab", 2],
    ["abc", 2],
    ["abcde", 2],
    ["abcdef", 2],
    ["abcdefgh", 2],
    ["abcdefghi", 3],
    ["abcdefghijklmn", 4],
    ["a".repeat(100), 35],
  ] as const)("length %p -> %p", (arg, expected) => {
    expect(similarFlagDistanceLimit(arg)).toBe(expected);
  });
});

describe("levenshteinDistance EP/BVA", () => {
  test.each([
    ["", "", 0],
    ["", "abc", 3],
    ["abc", "", 3],
    ["hello", "hello", 0],
    ["cat", "car", 1],
    ["cat", "cats", 1],
    ["cats", "cat", 1],
    ["abc", "xyz", 3],
    ["ab", "ba", 2],
    ["a", "", 1],
    ["", "a", 1],
  ] as const)("%p vs %p -> %p", (a, b, expected) => {
    expect(levenshteinDistance(a, b)).toBe(expected);
  });
});

describe("resolveOptionFlag similar flags boundary", () => {
  test.each([
    ["finds similar when distance <= limit", "--repositry", "unknown option: --repositry"],
    ["distance > limit", "--zzzzzzz", /^unknown option: --zzzzzzz$/],
    ["short arg with no match", "--zzz", /^unknown option: --zzz$/],
    ["distance == bestDistance + 2", "--zzzzz", /^unknown option: --zzzzz$/],
  ] as const)("%s", (_name, arg, error) => {
    expect(() => resolveOptionFlag(arg, knownFlags)).toThrow(error);
  });

  test("max 6 similar flags in output", () => {
    // use a flag far from all known ones to get few suggestions
    const fn = () => resolveOptionFlag("--mmmmmmm", knownFlags);
    expect(fn).toThrow();
  });
});

describe("resolveOptionFlag prefix matching EP", () => {
  test.each([
    ["exact match", "--top", { flag: "--top" }],
    ["unique prefix", "--repo", { flag: "--repository-only", resolvedFrom: "--repo" }],
    ["non-option", "handoff", { flag: "handoff" }],
  ] as const)("%s", (_name, arg, expected) => {
    expect(resolveOptionFlag(arg, knownFlags)).toEqual(expected);
  });

  test.each([
    ["ambiguous prefix", "--show", "ambiguous option"],
    ["unknown with suggestions", "--formt", "unknown option"],
  ] as const)("%s", (_name, arg, error) => {
    expect(() => resolveOptionFlag(arg, knownFlags)).toThrow(error);
  });
});
