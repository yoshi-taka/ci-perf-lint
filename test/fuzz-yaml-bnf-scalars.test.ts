import { expect, test } from "bun:test";
import fc from "fast-check";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";

const options = { numRuns: 100, interruptAfterTimeLimit: 4000, markInterruptAsFailure: true };

function check(source: string): void {
  const reference = referenceParse(source);
  const candidate = parseDocument(source);
  if (reference.errors.length > 0 || reference.warnings.length > 0) {
    // This property targets valid scalar/BNF behavior. Invalid-input presence
    // is covered by the dedicated boundary and error corpora instead.
    return;
  }
  expect(candidate.errors).toEqual([]);
  expect(candidate.warnings).toEqual([]);
  expect(candidate.toJS()).toEqual(reference.toJS());
  expect(candidate.contents?.toJSON()).toEqual(reference.contents?.toJSON());
}

const textLine = fc
  .array(fc.constantFrom("a", "b", "0", " ", "\t", "#", "-", ":", "'", '"'), {
    maxLength: 24,
  })
  .map((parts) => parts.join("").trimEnd());

const blockScalar = fc
  .tuple(
    fc.constantFrom("|", ">"),
    fc.constantFrom("", "-", "+"),
    fc.constantFrom("", "1", "2", "3", "4"),
    fc.array(fc.oneof(textLine, fc.constant("")), { minLength: 1, maxLength: 5 }),
    fc.constantFrom(0, 2),
  )
  .map(([style, chomp, indicator, lines, extraIndent]) => {
    const indent = (indicator === "" ? 2 : Number(indicator)) + extraIndent;
    const body = lines
      .map((line) => (line === "" ? "" : `${" ".repeat(indent)}${line}`))
      .join("\n");
    const trailing = chomp === "+" ? "\n\n" : "\n";
    return `key: ${style}${indicator}${chomp}\n${body}${trailing}`;
  });

const doubleQuoted = fc
  .array(
    fc.oneof(
      fc.constantFrom("a", "b", " ", "-", ":", "#", "/", "🎉", "☺"),
      fc.constantFrom("\\n", "\\t", "\\x41", "\\u263A", "\\U0001F600", "\\N", "\\_", "\\L", "\\P"),
    ),
    { maxLength: 12 },
  )
  .map((parts) => `value: "${parts.join("")}"\n`);

const singleQuoted = fc
  .array(fc.constantFrom("a", "b", " ", "-", ":", "#", "/", "🎉", "''"), { maxLength: 12 })
  .map((parts) => `value: '${parts.join("")}'\n`);

const plainMultiline = fc
  .tuple(
    fc.array(
      textLine.filter((line) => line !== "" && !/^[#&*!|>'"%@`[\]{},?:-]/.test(line)),
      {
        minLength: 1,
        maxLength: 4,
      },
    ),
    fc.constantFrom(2, 4),
    fc.constantFrom(0, 1, 2),
  )
  .map(([lines, indent, blanks]) => {
    const separator = `\n${"\n".repeat(blanks)}`;
    return `value: ${lines[0]}\n${lines
      .slice(1)
      .map((line) => `${" ".repeat(indent)}${line}`)
      .join(separator)}\n`;
  });

for (let batch = 0; batch < 5; batch++) {
  test(`fuzz: BNF block scalar headers and content (batch ${batch + 1})`, () => {
    fc.assert(fc.property(blockScalar, check), options);
  });
}

for (let batch = 0; batch < 3; batch++) {
  test(`fuzz: BNF double-quoted escapes (batch ${batch + 1})`, () => {
    fc.assert(fc.property(doubleQuoted, check), options);
  });
  test(`fuzz: BNF single-quoted scalars (batch ${batch + 1})`, () => {
    fc.assert(fc.property(singleQuoted, check), options);
  });
  test(`fuzz: BNF plain multiline scalars (batch ${batch + 1})`, () => {
    fc.assert(fc.property(plainMultiline, check), options);
  });
}
