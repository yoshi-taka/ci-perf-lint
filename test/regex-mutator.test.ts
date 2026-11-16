import { describe, expect, test } from "bun:test";
import { anchorRemovalLength, mutateRegexPattern } from "../src/mutation/regex-mutator.ts";

const cases: [string, string, string[]][] = [
  ["^abc$", "", ["abc$", "^abc"]],
  ["^", "", []],
  ["$", "", []],
  ["[\\d\\s]", "", ["[^\\d\\s]", "[\\D\\s]", "[\\d\\S]"]],
  ["\\d+\\w*", "", ["\\d\\w*", "\\D+\\w*", "\\d+\\w", "\\d+\\W*"]],
  ["a{2,4}?", "", ["a"]],
  ["(?=\\d+)", "", ["(?!\\d+)", "(?=\\d)", "(?=\\D+)"]],
  ["[^a-z]+", "", ["[^a-z]", "[a-z]+"]],
  ["\\p{Alpha}", "u", ["\\P{Alpha}"]],
  ["(?:^|_)", "", ["(?:_)"]],
  ["(?<name>a)+", "", ["(?<name>a)"]],
  ["a??b*?", "", ["ab*?", "a??b"]],
  ["[^\\d]", "", ["[\\d]", "[^\\D]"]],
  ["^a|^b", "", ["a|^b", "^a|b"]],
  ["a$|b$", "", ["a|b$", "a$|b"]],
  [
    "\\.[cm]?[jt]sx?$",
    "",
    [
      "\\.[cm][jt]sx?$",
      "\\.[^cm]?[jt]sx?$",
      "\\.[cm]?[^jt]sx?$",
      "\\.[cm]?[jt]sx$",
      "\\.[cm]?[jt]sx?",
    ],
  ],
  [
    "@effect[/][^/]+$",
    "",
    ["@effect[^/][^/]+$", "@effect[/][^/]$", "@effect[/][/]+$", "@effect[/][^/]+"],
  ],
  ["`([^`])`", "", ["`([`])`"]],
];

describe("regex mutator (level 1)", () => {
  test.each(cases)("%s (flags %s)", (pattern, flags, expected) => {
    expect(mutateRegexPattern(pattern, flags)).toEqual(expected);
  });

  test("anchor removal length matches the formal decision table", () => {
    for (const atStart of [false, true]) {
      for (const nextPipe of [false, true]) {
        for (const prevPipe of [false, true]) {
          expect(anchorRemovalLength(atStart, nextPipe, prevPipe)).toBe(
            atStart && (nextPipe || prevPipe) ? 2 : 1,
          );
        }
      }
    }
  });

  test("every mutant differs and the result is deterministic", () => {
    for (const [pattern, flags, expected] of cases) {
      const mutants = mutateRegexPattern(pattern, flags);
      expect(mutants).toEqual(expected);
      expect(mutateRegexPattern(pattern, flags)).toEqual(mutants);
      for (const mutant of mutants) {
        expect(mutant).not.toBe(pattern);
      }
    }
  });
});
