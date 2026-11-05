import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { collectDockerfileInstructions } from "../src/repository-diagnostics/dockerfile-parser.ts";

const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
type Command = {
  keyword: string;
  flags: { name: string; value: string | null }[];
  tokens: string[];
  jsonStrings: string[];
};

// A small, explicit grammar of valid instruction evidence. Expected values come
// from these records, never from parsing the generated source with the same code.
const commandArbitrary = fc
  .record({
    keyword: fc.constantFrom("FROM", "RUN", "COPY", "ADD", "CMD"),
    name: fc.stringMatching(/^[a-z]{1,12}$/),
    payload: fc.string({ maxLength: 40 }),
    json: fc.boolean(),
    flag: fc.boolean(),
  })
  .map(({ keyword, name, payload, json, flag }): Command => {
    if (keyword === "FROM") {
      return {
        keyword,
        flags: flag ? [{ name: "platform", value: "linux/amd64" }] : [],
        tokens: ["alpine:3.22", "AS", name],
        jsonStrings: [],
      };
    }
    const copy = keyword === "COPY" || keyword === "ADD";
    const values = copy ? [payload, "/app/"] : ["echo", payload];
    return {
      keyword,
      flags:
        flag && keyword === "RUN" ? [{ name: "mount", value: "type=cache,target=/cache" }] : [],
      tokens: json ? [JSON.stringify(values)] : copy ? [name, "/app/"] : ["echo", name],
      jsonStrings: json ? values : [],
    };
  });

function tokens(command: Command, lower = false): string[] {
  return [
    lower ? command.keyword.toLowerCase() : command.keyword,
    ...command.flags.map((flag) => `--${flag.name}${flag.value === null ? "" : `=${flag.value}`}`),
    ...command.tokens,
  ];
}

function evidence(source: string) {
  return collectDockerfileInstructions(source.split("\n")).map((entry) => ({
    keyword: entry.keyword,
    startLine: entry.startLine,
    argumentsContent: entry.argumentsContent,
    flags: entry.flags ?? [],
    jsonStrings: entry.jsonStrings ?? [],
  }));
}

describe("fuzz: Dockerfile grammar and metamorphic properties", () => {
  test("whitespace, comments, case and continuation transformations preserve generated semantics", () => {
    fc.assert(
      fc.property(
        fc.array(commandArbitrary, { minLength: 1, maxLength: 15 }),
        fc.record({
          escape: fc.constantFrom("\\", "`"),
          newline: fc.constantFrom("\n", "\r\n"),
          comments: fc.boolean(),
          lower: fc.boolean(),
          continued: fc.boolean(),
          indent: fc.boolean(),
        }),
        (commands, variant) => {
          const lines = [`# escape=${variant.escape}`];
          const expected = [];
          for (const command of commands) {
            if (variant.comments) {
              lines.push("# a safe instruction boundary", "");
            }
            const startLine = lines.length + 1;
            const words = tokens(command, variant.lower);
            if (variant.continued) {
              for (let i = 0; i < words.length; i++) {
                lines.push(
                  `${i === 0 && variant.indent ? "  " : ""}${words[i]}${i < words.length - 1 ? ` ${variant.escape}` : ""}`,
                );
                if (variant.comments && i < words.length - 1) {
                  lines.push(" # inside a continuation", "");
                }
              }
            } else {
              lines.push(`${variant.indent ? "\t" : ""}${words.join(" ")}  `);
            }
            expected.push({
              keyword: command.keyword,
              startLine,
              argumentsContent: command.tokens.join(" "),
              flags: command.flags,
              jsonStrings: command.jsonStrings,
            });
          }
          expect(evidence(lines.join(variant.newline))).toEqual(expected);
        },
      ),
      options,
    );
  });

  test("concatenating complete instruction sequences only shifts right-hand line numbers", () => {
    fc.assert(
      fc.property(
        fc.array(commandArbitrary, { minLength: 1, maxLength: 10 }),
        fc.array(commandArbitrary, { minLength: 1, maxLength: 10 }),
        (left, right) => {
          const render = (commands: Command[]) =>
            commands.map((command) => tokens(command).join(" ")).join("\n");
          const first = render(left),
            second = render(right);
          const shifted = evidence(second).map((entry) => ({
            ...entry,
            startLine: entry.startLine + left.length,
          }));
          expect(evidence(`${first}\n${second}`)).toEqual([...evidence(first), ...shifted]);
        },
      ),
      options,
    );
  });
});
