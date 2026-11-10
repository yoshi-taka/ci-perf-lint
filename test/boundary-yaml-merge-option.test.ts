import { describe, expect, test } from "bun:test";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";
import { parseCircleCi, getCircleCiLocation } from "../src/circleci-workflow.ts";

const anchors = "a: &a {shared: first, x: 1}\nb: &b {shared: second, y: 2}\n";

describe("opt-in YAML merge keys", () => {
  for (const body of [
    "out:\n  <<: *a\n  <<: *b\n",
    "out: {<<: [*a, *b]}\n",
    "out: {shared: explicit, <<: *a, <<: *b}\n",
    "out: {<<: *a, <<: *b, shared: explicit}\n",
    'out: {<<: *a, "<<": literal}\n',
    'out: {"<<": literal, <<: *a}\n',
    "out: {<<: *a, !!merge <<: *b}\n",
    "out: {<<: *a, on: yes, no: off}\n",
  ]) {
    test(`matches merge-enabled reference semantics: ${body.trim()}`, () => {
      const source = anchors + body;
      const owned = parseDocument(source, { merge: true });
      const reference = referenceParse(source, { merge: true });
      expect(owned.errors).toEqual([]);
      expect(reference.errors).toEqual([]);
      expect(owned.toJS()).toEqual(reference.toJS());
    });
  }

  for (const body of [
    "out: {<<: *a, ordinary: 1, ordinary: 2}\n",
    'out: {<<: *a, "<<": one, "<<": two}\n',
    "out: {<<: *a, !!str <<: one, !!str <<: two}\n",
    "out: {<<: *a, nested: {x: 1, x: 2}}\n",
    "out: {<<: *a, 1: one, 1.0: two}\n",
  ]) {
    test(`still rejects ordinary duplicate keys: ${body.trim()}`, () => {
      const source = anchors + body;
      const owned = parseDocument(source, { merge: true });
      const reference = referenceParse(source, { merge: true });
      expect(owned.errors.some((e) => e.code === "DUPLICATE_KEY")).toBe(true);
      expect(reference.errors.some((e) => e.code === "DUPLICATE_KEY")).toBe(true);
    });
  }

  test("does not enable merging globally or reinterpret ordinary YAML booleans", () => {
    expect(
      parseDocument(`${anchors}out: {<<: *a, <<: *b}`).errors.some(
        (e) => e.code === "DUPLICATE_KEY",
      ),
    ).toBe(true);
    expect(parseDocument("on: yes\nno: off\n", { merge: true }).toJS()).toEqual({
      on: "yes",
      no: "off",
    });
    expect(
      parseDocument(`${anchors}out: {"<<": one, "<<": two}`, { merge: true }).errors.some(
        (e) => e.code === "DUPLICATE_KEY",
      ),
    ).toBe(true);
    // An explicit string tag is not a merge directive. The reference package
    // treats this plain-spelled !!str key as a merge, so test this boundary directly.
    const tagged = parseDocument(`${anchors}out: {<<: *a, !!str <<: literal}`, { merge: true });
    expect(tagged.errors).toEqual([]);
    expect(tagged.toJS()).toMatchObject({ out: { shared: "first", x: 1, "<<": "literal" } });
  });

  test("retains non-duplicate syntax errors and alias safety limits", () => {
    expect(parseDocument("out: [unclosed", { merge: true }).errors.length).toBeGreaterThan(0);
    expect(() => parseDocument("out: {<<: *missing}", { merge: true }).toJS()).toThrow(
      /Unresolved alias/,
    );
    expect(() => parseDocument("out: {<<: 1}", { merge: true }).toJS()).toThrow(
      /Merge sources must be maps/,
    );
    expect(() => parseDocument("out: &self {<<: *self}", { merge: true }).toJS()).toThrow(
      /alias count/,
    );
  });

  test("CircleCI resolves repeated workflow merge keys without losing source locations", () => {
    const source = [
      "version: 2.1",
      "defaults: &defaults {context: release}",
      "filters: &filters {filters: {branches: {ignore: /.*/}}}",
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: docker build --no-cache .",
      "workflows:",
      "  release:",
      "    jobs:",
      "      - build:",
      "          <<: *defaults",
      "          <<: *filters",
    ].join("\n");
    const doc = parseCircleCi("/repo/.circleci/config.yml", "/repo", source);
    expect(doc.jobs).toHaveLength(1);
    expect(doc.jobs[0]?.steps[0]?.command).toBe("docker build --no-cache .");
    expect(getCircleCiLocation(doc, doc.jobs[0]?.steps[0]?.commandNode)).toEqual({
      path: ".circleci/config.yml",
      line: 7,
      column: 14,
    });
    expect(doc.parsed?.workflows).toEqual({
      release: {
        jobs: [{ build: { context: "release", filters: { branches: { ignore: "/.*/" } } } }],
      },
    });
    expect(doc.parsed).toBe(doc.parsed);
    expect(() =>
      parseCircleCi(
        "/repo/.circleci/config.yml",
        "/repo",
        source.replace("context: release", "context: release, context: other"),
      ),
    ).toThrow(/Map keys must be unique/);
  });
});
