import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { collectDockerfileInstructions } from "../src/repository-diagnostics/dockerfile-parser.ts";

const options = { numRuns: 500, interruptAfterTimeLimit: 10000 };
const parse = (text: string) => collectDockerfileInstructions(text.split("\n"));

describe("fuzz: Dockerfile evidence extraction", () => {
  test("JSON forms round-trip quoted strings without creating extra instructions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("COPY", "ADD", "RUN", "CMD", "ENTRYPOINT", "SHELL", "VOLUME"),
        fc.array(fc.string({ maxLength: 100 }), { maxLength: 10 }),
        (keyword, values) => {
          const entries = parse(`${keyword} ${JSON.stringify(values)}\nFROM alpine`);
          expect(entries).toHaveLength(2);
          expect(entries[0]?.jsonStrings).toEqual(values);
          expect(entries[1]?.startLine).toBe(2);
        },
      ),
      options,
    );
  });

  test("heredoc bodies are opaque regardless of fake instructions and escape characters", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{1,12}$/),
        fc.array(
          fc.oneof(
            fc
              .string({ maxLength: 80 })
              .map((value) => value.replaceAll("\n", "").replaceAll("\r", "")),
            fc.constantFrom(
              "FROM evil",
              "COPY . /app",
              "RUN npm install \\",
              "# escape=`",
              "",
              "\tEOF",
            ),
          ),
          { maxLength: 30 },
        ),
        fc.constantFrom("", "'", '"'),
        fc.boolean(),
        fc.constantFrom("\n", "\r\n"),
        (delimiter, generated, quote, stripTabs, newline) => {
          const body = generated.map((line) =>
            line.replace(/^\t+/, "") === delimiter ? `${line}_` : line,
          );
          const header = `RUN cat <<${stripTabs ? "-" : ""}${quote}${delimiter}${quote}`;
          const entries = parse(
            [header, ...body, `${stripTabs ? "\t" : ""}${delimiter}`, "FROM alpine"].join(newline),
          );
          expect(entries).toHaveLength(2);
          expect(entries[0]?.keyword).toBe("RUN");
          expect(entries[1]?.keyword).toBe("FROM");
          expect(entries[1]?.startLine).toBe(body.length + 3);
        },
      ),
      options,
    );
  });

  test("continuations preserve tokens for either escape directive", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,15}$/), { minLength: 1, maxLength: 20 }),
        fc.constantFrom("\\", "`"),
        fc.constantFrom("\n", "\r\n"),
        (words, escape, newline) => {
          const continued = `# escape=${escape}${newline}RUN ${words.join(` ${escape}${newline}`)}`;
          expect(parse(continued)[0]?.argumentsContent).toBe(words.join(" "));
        },
      ),
      options,
    );
  });

  test("arbitrary input never throws and instruction locations stay ordered and in bounds", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const lines = text.split("\n");
        const entries = collectDockerfileInstructions(lines);
        let previous = 0;
        for (const entry of entries) {
          expect(entry.startLine).toBeGreaterThan(previous);
          expect(entry.startLine).toBeLessThanOrEqual(lines.length);
          expect(typeof entry.text).toBe("string");
          previous = entry.startLine;
        }
      }),
      options,
    );
  });
});
