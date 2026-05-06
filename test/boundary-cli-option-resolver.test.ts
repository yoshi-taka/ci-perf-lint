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
    const fn = () => resolveOptionFlag("--mmmmmmm", knownFlags);
    expect(fn).toThrow();
  });

  test("shows suggestions when best distance equals distance limit", () => {
    const fn = () => resolveOptionFlag("--foramt", knownFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--format");
  });

  test("caps similar flag suggestions at 6 when many are similar", () => {
    const manyFlags = [
      "--flag-01",
      "--flag-02",
      "--flag-03",
      "--flag-04",
      "--flag-05",
      "--flag-06",
      "--flag-07",
      "--flag-08",
      "--flag-09",
    ];
    const fn = () => resolveOptionFlag("--flag-00", manyFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--flag-01");
    expect(fn).toThrow("--flag-06");
    expect(fn).not.toThrow("--flag-07");
  });

  test("filters flags beyond similarity threshold", () => {
    const variedFlags = ["--abc", "--bcd", "--cde", "--abdc", "--aaaaaa"];
    const fn = () => resolveOptionFlag("--ace", variedFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--abc");
    expect(fn).toThrow("--bcd");
    expect(fn).toThrow("--cde");
    expect(fn).toThrow("--abdc");
    expect(fn).not.toThrow("--aaaaaa");
  });

  test("matches flags via suffix-based variants", () => {
    const fn = () => resolveOptionFlag("--findigns", knownFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--findings-only");
  });

  test("matches --show-all-locations via -locations suffix variant", () => {
    const fn = () => resolveOptionFlag("--show-alx", knownFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--show-all-locations");
  });

  test("matches --show-workflows via -workflows suffix variant", () => {
    const fn = () => resolveOptionFlag("--show-wx", knownFlags);
    expect(fn).toThrow("The most similar options are");
    expect(fn).toThrow("--show-workflows");
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
