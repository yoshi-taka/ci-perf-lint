import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse, isScalar as referenceScalar } from "yaml";
import { parseDocument, isScalar } from "../src/yaml.ts";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

const literals = [
  "null",
  "NULL",
  "~",
  "true",
  "FALSE",
  "yes",
  "NO",
  "on",
  "off",
  "y",
  "N",
  "-0",
  "+0",
  "012",
  "-012",
  "0o17",
  "0x2a",
  "-0xA_F",
  "0b1010",
  "1_000",
  "1.200",
  "-0.000",
  "1_2.0_0",
  "1e3",
  "1e-9999",
  "1e9999",
  ".NaN",
  "-.Inf",
  "1:20",
  "-0:21",
  "123:45:56.120",
  "9007199254740993",
  "2026-11-07",
  "0099-01-01",
  "2026-2-30",
  "2026-11-07T12:34:56.123+02:30",
  "!!timestamp '2026-11-07T12:34:56+29'",
  "!!timestamp '2026-11-07T12:34:56-30'",
  "!!str true",
  "!!int '42'",
  "!!float '1.200'",
  "!!bool invalid",
  "!!null invalid",
  "!!int invalid",
  "!!float invalid",
  "!!timestamp invalid",
  "!!binary aGVsbG8=",
  "!!binary 'Y W\n  Fh'",
  "!!binary 'ab-c_d'",
  "!!binary ''",
];

describe("owned YAML scalar resolution", () => {
  test("active numeric/boolean/null/date/binary resolution does not call native callbacks", () => {
    // Isolate mutation of the reference package's shared tag records from other tests.
    const program = `
      import {parseDocument as native} from "yaml";
      import {parseDocument} from ${JSON.stringify(new URL("../src/yaml.ts", import.meta.url).href)};
      const schemas = [native("x").schema, native("%YAML 1.1\\n---\\nx").schema];
      const supported = new Set(["null", "bool", "int", "float", "timestamp", "binary"].map(name => "tag:yaml.org,2002:" + name));
      for (const schema of schemas) for (const tag of schema.tags) {
        if (supported.has(tag.tag)) tag.resolve = () => {throw new Error("Native scalar resolver called");};
      }
      for (const version of ["1.1", "1.2"]) {
        const doc = parseDocument("%YAML " + version + "\\n---\\nprecision: 1.200\\nvalues: [null, true, FALSE, 42, 0x2a, .NaN, -.Inf]\\n");
        if (doc.errors.length || doc.get("precision", true).minFractionDigits !== 3) throw new Error("Scalar callback substitution failed");
        const value = doc.toJS();
        if (JSON.stringify(value.values) !== '[null,true,false,42,42,null,null]') throw new Error("Unexpected scalar values");
      }
      const legacy = parseDocument("%YAML 1.1\\n---\\n[yes, 0b1010, 1:20, 2026-11-07, !!binary aGVsbG8=]");
      if (legacy.errors.length) throw new Error("Legacy scalar callback substitution failed");
      const values = legacy.toJS();
      if (values[0] !== true || values[1] !== 10 || values[2] !== 80 || !(values[3] instanceof Date) || Buffer.from(values[4]).toString() !== "hello") throw new Error("Unexpected legacy scalar values");
      const core = parseDocument("[!!timestamp 2026-11-07, !!binary aGVsbG8=, 2026-11-07, yes]");
      if (core.errors.length) throw new Error("Core explicit scalar callback substitution failed");
      const coreValues = core.toJS();
      if (!(coreValues[0] instanceof Date) || Buffer.from(coreValues[1]).toString() !== "hello" || coreValues[2] !== "2026-11-07" || coreValues[3] !== "yes") throw new Error("Explicit scalar tags changed implicit core types");
      console.log("owned scalar callbacks verified");
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", program], {
      cwd: new URL("..", import.meta.url).pathname,
    });
    expect(child.stderr.toString()).toBe("");
    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString().trim()).toBe("owned scalar callbacks verified");
  });

  for (const version of ["1.1", "1.2"]) {
    test.each(literals)(`YAML ${version} values and scalar metadata: %s`, (literal) => {
      const source = `%YAML ${version}\n---\n${literal}\n`;
      const actual = parseDocument(source);
      const expected = referenceParse(source);
      expect(isScalar(actual.contents)).toBe(true);
      expect(referenceScalar(expected.contents)).toBe(true);
      if (!isScalar(actual.contents) || !referenceScalar(expected.contents)) {
        throw new Error("Expected scalar roots");
      }
      if (expected.errors.length || expected.warnings.length) {
        expect(actual.errors.length + actual.warnings.length).toBeGreaterThan(0);
        return;
      }
      const a = actual.contents;
      const b = expected.contents;
      expect({
        value: a.value,
        source: a.source,
        format: a.format,
        precision: a.minFractionDigits,
        type: a.type,
        tag: a.tag,
        range: a.range,
      }).toEqual({
        value: b.value,
        source: b.source,
        format: b.format,
        precision: b.minFractionDigits,
        type: b.type,
        tag: b.tag,
        range: b.range,
      });
      expect(actual.errors).toEqual(expected.errors);
      expect(actual.warnings).toEqual(expected.warnings);
      compareDocumentConversion(source);
    });
  }

  test.each(["1.1", "1.2"])(
    "numeric keys, duplicate detection and precision share YAML %s resolution",
    (version) => {
      for (const body of [
        "{1.200: first, 1.2: second}",
        "{true: first, TRUE: second}",
        "{0x2a: first, 42: second}",
        "[&value 1.200, *value, {nested: !!float '1.200'}]",
        "? [1.200, -0.000, 0x2a, 1:20, !!float invalid]\n: output",
        "[!!str '1.200', 1.200, '1.200', !!float '1.200']",
      ]) {
        compareDocumentConversion(`%YAML ${version}\n---\n${body}`);
      }
    },
  );
});
