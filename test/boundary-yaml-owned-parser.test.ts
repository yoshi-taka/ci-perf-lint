import { describe, expect, test } from "bun:test";
import { parseDocument as nativeParse } from "yaml";
import { LineCounter, parseDocument } from "../src/yaml.ts";
import { parseYaml } from "../src/yaml-parse.ts";

describe("owned parser integration", () => {
  test("valid documents are served by the independent parser", () => {
    for (const source of [
      "name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
      "%YAML 1.1\n---\non: yes\nnumbers: [012, 0b1010, 1:20]\n",
      "base: &base {run: echo ok}\ncopy: *base\n",
      "run: |-\n  first\n  second\n",
      "? [one, two]\n: value\n",
      "-#: {}\n",
      "on:\n  (': false\n",
      "- (' b: false\n",
      "!!set {one, two}\n",
      "%YAML 1.1\n---\nsources:\n  - &a {k0: v1, k1: v1}\n  - &b {k1: v2, k2: v2}\nresult:\n  k0: v0\n  <<: *a\n  <<: *b\n",
    ]) {
      const owned = parseYaml(source);
      expect(owned.errors).toEqual([]);
      expect(owned.warnings).toEqual([]);
      expect(parseDocument(source).toJS()).toEqual(nativeParse(source).toJS());
    }
  });

  test("invalid or unsupported documents defer to the native diagnostics path", () => {
    for (const source of [
      "key: first\nkey: second\n",
      "- bad\n  indent: value\n",
      "a: 1\n  b: 2\n",
      "key0;\n  {key0: one, key1: []}\n",
      "- bad\n  indent: value\n# comment\n- -0\n- 1.200\n",
      "---\nkey: value\n... invalid\n",
      "---\none\n---\ntwo\n",
      "[unclosed\n",
      "key: !!timestamp invalid\n",
      "value: !unknown thing\n",
    ]) {
      const parsed = parseYaml(source);
      expect(parsed.errors.length + parsed.warnings.length).toBeGreaterThan(0);
      const document = parseDocument(source);
      const reference = nativeParse(source);
      const expected = reference.errors[0];
      const actual = document.errors[0];
      expect(actual?.code).toBe(expected?.code);
      expect(actual?.message).toBe(expected?.message);
      expect(actual?.pos).toEqual(expected?.pos);
    }
  });

  test("duplicate handling honors the uniqueKeys option through fallback", () => {
    const source = "key: first\nkey: second\n";
    const permitted = parseDocument(source, { uniqueKeys: false });
    const reference = nativeParse(source, { uniqueKeys: false });
    expect(permitted.errors.map((error) => error.code)).toEqual(
      reference.errors.map((error) => error.code),
    );
    expect(permitted.toJS()).toEqual(reference.toJS());
    expect(parseDocument(source).errors.map((error) => error.code)).toContain("DUPLICATE_KEY");
  });

  test("owned parsing fills the UTF-16 line counter exactly like the reference", () => {
    const source = 'emoji: 🌟\r\njobs:\r\n  build:\r\n    run: "echo done" # tail\r\n';
    const ownedCounter = new LineCounter();
    const referenceCounter = new LineCounter();
    const owned = parseDocument(source, { lineCounter: ownedCounter });
    nativeParse(source, { lineCounter: referenceCounter });
    expect(ownedCounter.lineStarts).toEqual(referenceCounter.lineStarts);
    expect(owned.toJS()).toEqual(nativeParse(source).toJS());
  });

  test("scalar formats, tags and comments remain identical for owned documents", () => {
    const source =
      "%YAML 1.2\n---\n# before\nnumber: 1.200 # after\nbinary: !!binary aGVsbG8=\ndate: !!timestamp 2026-11-07\n";
    const owned = parseYaml(source);
    expect(owned.errors).toEqual([]);
    expect(parseDocument(source).toJS()).toEqual(nativeParse(source).toJS());
    expect(parseDocument(source).contents?.toJSON()).toEqual(
      nativeParse(source).contents?.toJSON(),
    );
  });
});
