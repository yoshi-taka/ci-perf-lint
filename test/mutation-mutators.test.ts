import { describe, expect, test } from "bun:test";
import { parseSync } from "oxc-parser";
import { generateMutants, type Mutant } from "../src/mutation/mutators.ts";
import { applyMutant } from "../src/mutation/apply.ts";

function generate(source: string, file = "sample.ts"): Mutant[] {
  return generateMutants(file, source).mutants;
}

function apply(source: string, mutant: Mutant): string {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}

function replacements(source: string, mutator: string): string[] {
  return generate(source)
    .filter((mutant) => mutant.mutator === mutator)
    .map((mutant) => mutant.replacement)
    .sort();
}

function expectValidMutants(source: string): void {
  for (const mutant of generate(source)) {
    const mutated = apply(source, mutant);
    const parsed = parseSync("sample.ts", mutated);
    expect(parsed.errors, `mutant ${mutant.mutator} ${JSON.stringify(mutant.replacement)}`).toEqual(
      [],
    );
    expect(mutated).not.toBe(source);
  }
}

describe("mutation operators", () => {
  test("arithmetic skips string operands", () => {
    expect(replacements("const a = x + 1;", "ArithmeticOperator")).toEqual(["x - 1"]);
    expect(replacements('const a = "x" + y;', "ArithmeticOperator")).toEqual([]);
    expect(replacements("const a = `${x}` + y;", "ArithmeticOperator")).toEqual([]);
  });

  test("equality produces both relational replacements", () => {
    expect(replacements("const a = x < y;", "EqualityOperator")).toEqual(["x <= y", "x >= y"]);
    expect(replacements("const a = x === y;", "EqualityOperator")).toEqual(["x !== y"]);
  });

  test("logical operators keep grouping with parentheses", () => {
    expect(replacements("const a = (x || y) || z;", "LogicalOperator")).toEqual([
      "(x || y) && z",
      "x && y",
    ]);
    expect(replacements("const a = x ?? y;", "LogicalOperator")).toEqual(["x && y"]);
  });

  test("optional chaining drops the optional marker", () => {
    expect(replacements("const a = value?.name;", "OptionalChaining")).toEqual(["value.name"]);
    expect(replacements("const a = value?.[name];", "OptionalChaining")).toEqual(["value[name]"]);
    expect(replacements("const a = value?.();", "OptionalChaining")).toEqual(["value()"]);
  });

  test("method expressions replace or remove the method", () => {
    expect(replacements("const a = name.trim();", "MethodExpression")).toEqual(["name"]);
    expect(replacements("const a = name.toLowerCase();", "MethodExpression")).toEqual([
      "name.toUpperCase()",
    ]);
  });

  test("empty expression mutants require a lone call", () => {
    expect(replacements("merged.set(key, entry);", "CallExpression")).toEqual([";"]);
    expect(replacements('merged.set(key, "entry");', "CallExpression")).toEqual([]);
    expect(replacements("const a = merged.get(key);", "CallExpression")).toEqual([]);
  });

  test("conditional expressions mutate conditions and boolean expressions", () => {
    expect(replacements("if (!ready) { work(); }", "ConditionalExpression")).toEqual([
      "false",
      "true",
    ]);
    expect(replacements("while (left < right) { work(); }", "ConditionalExpression")).toEqual([
      "false",
    ]);
    expect(replacements("const ok = left < right;", "ConditionalExpression")).toEqual([
      "false",
      "true",
    ]);
    expect(
      replacements('switch (x) { case "a": work(); break; }', "ConditionalExpression"),
    ).toEqual(['case "a": ']);
  });

  test("string literals skip imports, keys and expression statements", () => {
    expect(replacements('import x from "mod";', "StringLiteral")).toEqual([]);
    expect(replacements('const a = { "key": 1 };', "StringLiteral")).toEqual([]);
    expect(replacements('"bare";', "StringLiteral")).toEqual([]);
    expect(replacements('const a = "value";', "StringLiteral")).toEqual(['""']);
    expect(replacements('const a = "";', "StringLiteral")).toEqual(['"Stryker was here!"']);
    expect(replacements('const a = "value" as const;', "StringLiteral")).toEqual([]);
  });

  test("regex literals use the local level-1 mutator", () => {
    const mutantReplacements = replacements("const a = /(\\d+)\\.(\\d+)/;", "Regex");
    expect(mutantReplacements).toContain("/(\\d)\\.(\\d+)/");
    expect(mutantReplacements.length).toBeGreaterThan(0);
  });

  test("arrow functions, arrays, objects and blocks", () => {
    expect(replacements("const a = (x: number) => x + 1;", "ArrowFunction")).toEqual([
      "() => undefined",
    ]);
    expect(replacements("const a = [1, 2];", "ArrayDeclaration")).toEqual(["[]"]);
    expect(replacements("const a = [];", "ArrayDeclaration")).toEqual(['["Stryker was here"]']);
    expect(replacements("const a = { x: 1 };", "ObjectLiteral")).toEqual(["{}"]);
    expect(replacements("function f() { return 1; }", "BlockStatement")).toEqual(["{}"]);
  });

  test("applied mutants satisfy the Lean splice contract", () => {
    const source = `export function pick(input: string | undefined, limit: number): string {
  return input?.trim() ?? "";
}`;
    const mutants = generate(source);
    expect(mutants.length).toBeGreaterThan(0);
    for (const mutant of mutants) {
      const mutated = applyMutant(source, mutant);
      expect(mutated.slice(0, mutant.start)).toBe(source.slice(0, mutant.start));
      expect(mutated.slice(mutant.start + mutant.replacement.length)).toBe(
        source.slice(mutant.end),
      );
      expect(source.slice(mutant.start, mutant.end)).not.toBe(mutant.replacement);
    }
  });

  test("every mutant stays parseable and deterministic", () => {
    const source = `import path from "node:path";
export function pick(input: string | undefined, limit: number): string {
  const trimmed = input?.trim() ?? "";
  if (!trimmed || limit < 1) {
    return path.basename(trimmed).toLowerCase();
  }
  const values = [trimmed, "x"];
  return values.filter((value) => value.length <= limit).join(",");
}`;
    expectValidMutants(source);
    expect(generate(source)).toEqual(generate(source));
  });
});
