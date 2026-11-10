import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseCiYaml } from "../src/ci-yaml.ts";
import { parseDocument, isMap, isScalar } from "../src/yaml.ts";
import { resolveYamlAst } from "../src/yaml-resolved-ast.ts";
import { convertDocument } from "../src/yaml-document.ts";
import type { CiKind } from "../src/ci-types.ts";

const mergeKinds = ["circleci", "gitlab-ci", "buildkite"] as const;
const allKinds: readonly CiKind[] = [...mergeKinds, "github-actions"];

describe("CI YAML reference normalization", () => {
  for (const kind of mergeKinds) {
    for (const body of [
      "out: {<<: *a, <<: *b}\n",
      "out: {<<: [*a, *b]}\n",
      "out: {x: explicit, <<: *a, <<: *b}\n",
      "out: {<<: *a, <<: *b, x: explicit}\n",
      "nested: &nested {<<: *a, z: nested}\nout: {<<: *nested, <<: *b}\n",
      'out: {<<: *a, "<<": literal}\n',
    ]) {
      test(`${kind}: normalized AST and document conversion agree with reference: ${body.trim()}`, () => {
        const source = `a: &a {x: first, command: echo first}\nb: &b {x: second, y: other}\n${body}`;
        const document = parseCiYaml(source, kind);
        const reference = referenceParse(source, { merge: true });
        expect(document.errors).toEqual([]);
        expect(document.toJS()).toEqual(reference.toJS());
        expect(document.toJSON()).toEqual(reference.toJSON());
        expect(document.contents?.toJSON()).toEqual(document.toJSON());
      });
    }
  }

  for (const kind of allKinds) {
    test(`${kind}: aliases resolve by preceding anchor definition, including redefinitions`, () => {
      const source =
        "a: &name {command: echo first}\nb: *name\nc: &name {command: echo second}\nd: *name\n";
      const doc = parseCiYaml(source, kind);
      expect(doc.errors).toEqual([]);
      expect(doc.toJS()).toEqual(referenceParse(source).toJS());
      expect(isMap(doc.contents)).toBe(true);
      const b = doc.get("b", true);
      const d = doc.get("d", true);
      expect(isMap(b) && b.get("command")).toBe("echo first");
      expect(isMap(d) && d.get("command")).toBe("echo second");
    });

    test(`${kind}: forward/cyclic aliases are explicit errors rather than missing commands`, () => {
      for (const source of [
        "out: *missing",
        "out: *later\nlater: &later [echo later]",
        "out: &self [*self]",
      ]) {
        const doc = parseCiYaml(source, kind);
        expect(doc.errors.some((e) => e.code === "BAD_REFERENCE")).toBe(true);
      }
    });
  }

  test("GitHub accepts aliases but rejects merges; quoted << is still data", () => {
    expect(parseCiYaml("a: &a {x: 1}\nout: *a", "github-actions").errors).toEqual([]);
    const merged = parseCiYaml("a: &a {x: 1}\nout: {<<: *a}", "github-actions");
    expect(merged.errors[0]?.message).toContain("merge keys are not supported");
    expect(parseCiYaml('out: {"<<": literal}', "github-actions").toJS()).toEqual({
      out: { "<<": "literal" },
    });
  });

  test("normalization preserves definition offsets and does not mutate the syntax AST", () => {
    const source = "a: &a\n  command: echo original\nout: {<<: *a}\n";
    const syntax = parseDocument(source, { merge: true });
    const before = syntax.toJS();
    const resolved = resolveYamlAst(syntax.contents!, { merge: true });
    expect(syntax.toJS()).toEqual(before);
    expect(convertDocument(resolved)).toEqual(before);
    expect(isMap(resolved)).toBe(true);
    const output = isMap(resolved) ? resolved.get("out", true) : undefined;
    const command = isMap(output) ? output.get("command", true) : undefined;
    expect(isScalar(command) && command.range?.[0]).toBe(source.indexOf("echo original"));
    expect(convertDocument(resolveYamlAst(resolved, { merge: true }))).toEqual(before);
  });

  test("alias keys resolving to << remain literal data after normalization", () => {
    const source = "key: &key <<\nbase: &base {x: 1}\nout: {*key : *base}\n";
    for (const kind of allKinds) {
      const doc = parseCiYaml(source, kind);
      expect(doc.errors).toEqual([]);
      expect(doc.toJS()).toEqual(
        referenceParse(source, { merge: kind !== "github-actions" }).toJS(),
      );
      expect(
        convertDocument(resolveYamlAst(doc.contents!, { merge: kind !== "github-actions" })),
      ).toEqual(doc.toJS());
    }
  });

  test("expanded-size and depth budgets account for shared cached targets", () => {
    const exponential = ["a0: &a0 [echo]"];
    for (let i = 1; i <= 8; i++) {
      exponential.push(
        `a${i}: &a${i} [${Array(10)
          .fill(`*a${i - 1}`)
          .join(", ")}]`,
      );
    }
    expect(parseCiYaml(exponential.join("\n"), "buildkite").errors[0]?.message).toContain(
      "expansion limit",
    );
    const deep = ["a0: &a0 [echo]"];
    for (let i = 1; i <= 300; i++) {
      deep.push(`a${i}: &a${i} [*a${i - 1}]`);
    }
    expect(parseCiYaml(deep.join("\n"), "circleci").errors[0]?.message).toContain("nesting limit");
  });

  test("repeated overlapping merges cannot evade the resolution-work budget", () => {
    const base = `base: &base {${Array.from({ length: 1000 }, (_, i) => `k${i}: v`).join(", ")}}`;
    const source = `${base}\nout:\n${Array(1100).fill("  <<: *base").join("\n")}\n`;
    expect(parseCiYaml(source, "gitlab-ci").errors[0]?.message).toContain("work limit");
  });

  test("merge-source type errors and ordinary duplicates remain errors", () => {
    for (const kind of mergeKinds) {
      expect(parseCiYaml("out: {<<: 1}", kind).errors[0]?.message).toContain(
        "Merge sources must be maps",
      );
      expect(parseCiYaml("out: &self {<<: *self}", kind).errors[0]?.message).toContain("Cyclic");
      expect(
        parseCiYaml("a: &a {x: 1}\nout: {<<: *a, x: 2, x: 3}", kind).errors.some(
          (e) => e.code === "DUPLICATE_KEY",
        ),
      ).toBe(true);
    }
  });
});
