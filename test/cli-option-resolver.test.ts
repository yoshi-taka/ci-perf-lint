import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { resolveOptionFlag } from "../src/cli-option-resolver.ts";

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

const uniqueFlagPrefixes = knownFlags.flatMap((flag) => {
  const prefixes: string[] = [];
  for (let length = 2; length < flag.length; length += 1) {
    const prefix = flag.slice(0, length);
    if (knownFlags.filter((candidate) => candidate.startsWith(prefix)).length === 1) {
      prefixes.push(prefix);
    }
  }
  return prefixes.map((prefix) => ({ flag, prefix }));
});

describe("resolveOptionFlag", () => {
  test("keeps exact option matches unchanged", () => {
    expect(resolveOptionFlag("--repository-only", knownFlags)).toEqual({
      flag: "--repository-only",
    });
  });

  test("resolves a unique option prefix", () => {
    expect(resolveOptionFlag("--repo", knownFlags)).toEqual({
      flag: "--repository-only",
      resolvedFrom: "--repo",
    });
    expect(resolveOptionFlag("--work", knownFlags)).toEqual({
      flag: "--workflow-only",
      resolvedFrom: "--work",
    });
  });

  test("rejects ambiguous option prefixes", () => {
    expect(() => resolveOptionFlag("--show", knownFlags)).toThrow(
      "ambiguous option: --show (could be --show-workflows, --show-all-locations)",
    );
  });

  test("suggests similar options for likely typos", () => {
    expect(() => resolveOptionFlag("--repositry", knownFlags)).toThrow(
      [
        "unknown option: --repositry",
        "",
        "The most similar options are",
        "\t--repository-only",
      ].join("\n"),
    );
  });

  test("omits suggestions when no option is similar enough", () => {
    expect(() => resolveOptionFlag("--zzzzzz", knownFlags)).toThrow(/^unknown option: --zzzzzz$/);
  });

  test("omits suggestions when no option is similar enough (empty knownFlags)", () => {
    expect(() => resolveOptionFlag("--anything", [])).toThrow(/^unknown option: --anything$/);
  });

  test("leaves non-option tokens unchanged", () => {
    expect(resolveOptionFlag("handoff", knownFlags)).toEqual({ flag: "handoff" });
  });

  test("preserves exact matches for any known flag", () => {
    fc.assert(
      fc.property(fc.constantFrom(...knownFlags), (flag) => {
        expect(resolveOptionFlag(flag, knownFlags)).toEqual({ flag });
      }),
    );
  });

  test("resolves any unique known prefix to its owning flag", () => {
    fc.assert(
      fc.property(fc.constantFrom(...uniqueFlagPrefixes), ({ flag, prefix }) => {
        expect(resolveOptionFlag(prefix, knownFlags)).toEqual({
          flag,
          resolvedFrom: prefix,
        });
      }),
    );
  });

  test("leaves any non-option token unchanged", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => !value.startsWith("--")),
        (value) => {
          expect(resolveOptionFlag(value, knownFlags)).toEqual({ flag: value });
        },
      ),
    );
  });
});
