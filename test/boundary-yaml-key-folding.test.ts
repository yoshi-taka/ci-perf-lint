import { describe, expect, test } from "bun:test";
import { foldKeyLines } from "../src/yaml-key-folding.ts";
import { foldFlowLines } from "yaml/util";

// Inputs are generated here, not copied from upstream test source. The installed
// parser is a black-box oracle; assertions compare observable string outputs.
describe("generated YAML key folding boundaries", () => {
  const words = ["runner", "cache", "artifact", "step", "queue", "restore"];
  const samples = [
    words.join(" "),
    words.join("  "),
    words.join("\t"),
    `${words.slice(0, 3).join(" ")}\n${words.slice(3).join(" ")}\n`,
    JSON.stringify(words.join(" ")),
    JSON.stringify(`${words.join(" ")}'\\"${words.join("  ")}`),
  ];
  for (const quoted of [false, true]) {
    test(`${quoted ? "quoted" : "plain"} width, indentation and escape grid`, () => {
      for (const text of samples) {
        for (const lineWidth of [1, 2, 9, 17, 39, 80]) {
          for (const minContentWidth of [0, 5, 20]) {
            for (const indentAtStart of [-9, 0, 8, 81]) {
              for (const indent of ["", " ", "     "]) {
                const options = { lineWidth, minContentWidth, indentAtStart };
                expect(foldKeyLines(text, indent, quoted, options)).toBe(
                  foldFlowLines(text, indent, quoted ? "quoted" : "flow", options),
                );
              }
            }
          }
        }
      }
    });
  }
  test("disabled wrapping preserves generated inputs exactly", () => {
    for (const text of samples) {
      for (const lineWidth of [-1, 0]) {
        expect(foldKeyLines(text, "     ", true, { lineWidth })).toBe(text);
        expect(foldKeyLines(text, "     ", false, { lineWidth })).toBe(text);
      }
    }
  });
});
