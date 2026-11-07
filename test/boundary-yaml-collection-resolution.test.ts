import { expect, test } from "bun:test";
import * as native from "yaml";
import { parseDocument, isMap, isSeq, isScalar } from "../src/yaml.ts";
import { Alias, Pair } from "../src/yaml-ast.ts";
import { resolveMergeTag } from "../src/yaml-collection-resolve.ts";
import { compareDocumentConversion } from "./yaml-document-test-helpers.ts";

function project(value: unknown): unknown {
  if (native.isPair(value) || value instanceof Pair) {
    return { key: project(value.key), value: project(value.value) };
  }
  if (
    !native.isNode(value) &&
    !isMap(value) &&
    !isSeq(value) &&
    !isScalar(value) &&
    !(value instanceof Alias)
  ) {
    return value;
  }
  const meta = {
    range: value.range,
    tag: "tag" in value ? value.tag : undefined,
    anchor: "anchor" in value ? value.anchor : undefined,
    comment: value.comment,
    commentBefore: value.commentBefore,
    spaceBefore: value.spaceBefore,
  };
  if (native.isScalar(value) || isScalar(value)) {
    return {
      kind: "scalar",
      value: typeof value.value === "symbol" ? { symbol: value.value.description } : value.value,
      source: value.source,
      type: value.type,
      format: value.format,
      minFractionDigits: value.minFractionDigits,
      ...meta,
    };
  }
  if (native.isAlias(value) || value instanceof Alias) {
    return { kind: "alias", source: value.source, ...meta };
  }
  const map = native.isMap(value) || isMap(value);
  return { kind: map ? "map" : "seq", items: value.items.map(project), ...meta };
}

const bodies = [
  "!!set {one, two}",
  "!!set {one: 1}",
  "!!set {one: !!null ''}",
  "!!set {one: # after\n null}",
  "!!omap [{first: one}, {first: two}]",
  "!!omap [{.nan: one}, {.nan: two}]",
  "!!omap [{1: one}, {1.0: two}]",
  "!!omap [{[one]: one}, {[one]: two}]",
  "!!pairs [one, null, {}, {first: one, second: two}]",
  "!!pairs\n- # before\n  {first: one} # after\n",
  "!!pairs\n-\n  # outer before\n  # inner before\n  first: # key after\n    # value before\n    one # value after\n",
  "!!pairs [\n\n # wrapper before\n {first: one}\n]",
  "!!omap [!!set {first}, !!pairs [{first: one}]]",
  "&root !!set {*root}",
  "&root !!omap [{self: *root}]",
  "{<<: {first: one}, <<: {second: two}}",
  "{!!merge one: {first: one}, !!merge two: {second: two}}",
  "[!!merge one, !!merge two, <<]",
];

for (const version of ["1.1", "1.2"]) {
  test.each(bodies)(
    `collection resolver metadata and diagnostics in YAML ${version}: %s`,
    (body) => {
      const source = `%YAML ${version}\n---\n${body}`;
      const actual = parseDocument(source);
      const expected = native.parseDocument(source);
      if (expected.errors.length || expected.warnings.length) {
        expect(actual.errors.length + actual.warnings.length).toBeGreaterThan(0);
        compareDocumentConversion(source, [0, 2, 100]);
        return;
      }
      expect(project(actual.contents)).toEqual(project(expected.contents));
      expect(actual.errors).toEqual([]);
      expect(actual.warnings).toEqual([]);
      compareDocumentConversion(source, [0, 2, 100]);
    },
  );
}

test("merge scalar values preserve descriptions without collapsing distinct key identities", () => {
  const first = resolveMergeTag("one");
  const second = resolveMergeTag("one");
  expect(first.mergeKey).toBe(true);
  expect(first.value.description).toBe("<<");
  expect(second.value.description).toBe("<<");
  expect(first.value).not.toBe(second.value);
});

test("active legacy collection/merge resolution uses neither native callbacks nor specialized constructors", () => {
  const program = `
    import {parseDocument as native} from "yaml";
    import {parseDocument} from ${JSON.stringify(new URL("../src/yaml.ts", import.meta.url).href)};
    const schema = native("%YAML 1.1\\n---\\nx").schema;
    const supported = new Set(["set", "omap", "pairs", "merge"].map(name => "tag:yaml.org,2002:" + name));
    for (const tag of schema.tags) if (supported.has(tag.tag)) {
      tag.resolve = () => {throw new Error("Native special resolver called");};
      if (tag.nodeClass) tag.nodeClass = class {constructor() {throw new Error("Native specialized constructor called");}};
    }
    const sources = ["!!set {one, two}", "!!omap [{first: one}, {second: two}]", "!!pairs [{first: one}, {first: two}]", "{<<: {first: one}, <<: {second: two}}"];
    const results = sources.map(body => {
      const doc = parseDocument("%YAML 1.1\\n---\\n" + body);
      if (doc.errors.length) throw new Error("Special schema callback substitution failed");
      return doc.toJS();
    });
    if (!(results[0] instanceof Set) || results[0].size !== 2) throw new Error("Set resolution failed");
    if (!(results[1] instanceof Map) || results[1].get("second") !== "two") throw new Error("Ordered map resolution failed");
    if (JSON.stringify(results[2]) !== '[{"first":"one"},{"first":"two"}]') throw new Error("Pair resolution failed");
    if (JSON.stringify(results[3]) !== '{"first":"one","second":"two"}') throw new Error("Merge resolution failed");
    console.log("owned collection resolvers verified");
  `;
  const child = Bun.spawnSync([process.execPath, "--eval", program], {
    cwd: new URL("..", import.meta.url).pathname,
  });
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString().trim()).toBe("owned collection resolvers verified");
});

test("core known collection, merge, binary and timestamp tags do not use native callbacks", () => {
  const program = `
    import {parseDocument as native} from "yaml";
    import {parseDocument} from ${JSON.stringify(new URL("../src/yaml.ts", import.meta.url).href)};
    const schema = native("x").schema;
    const supported = new Set(["set", "omap", "pairs", "merge", "binary", "timestamp"].map(name => "tag:yaml.org,2002:" + name));
    for (const [name, tag] of Object.entries(schema.knownTags)) if (supported.has(name)) {
      tag.resolve = () => {throw new Error("Native core known resolver called");};
      tag.stringify = () => {throw new Error("Native core known stringify called");};
    }
    for (const tag of schema.tags) if (supported.has(tag.tag)) tag.resolve = () => {throw new Error("Native core active resolver called");};
    const set = parseDocument("!!set {one, two}").toJS();
    if (!(set instanceof Set) || set.size !== 2) throw new Error("Core set resolution failed");
    const omap = parseDocument("!!omap [{first: one}, {second: two}]").toJS();
    if (!(omap instanceof Map) || omap.get("second") !== "two") throw new Error("Core omap resolution failed");
    const pairs = parseDocument("!!pairs [{first: one}, {first: two}]").toJS();
    if (JSON.stringify(pairs) !== '[{"first":"one"},{"first":"two"}]') throw new Error("Core pairs resolution failed");
    const scalars = parseDocument("[!!binary aGVsbG8=, !!timestamp 2026-11-07]").toJS();
    if (Buffer.from(scalars[0]).toString() !== "hello" || !(scalars[1] instanceof Date)) throw new Error("Core scalar known tags failed");
    let mergeError = "";
    try { parseDocument("{!!merge one: 1}").toJS(); } catch (error) { mergeError = error.message; }
    if (mergeError !== "Merge sources must be maps or map aliases") throw new Error("Core merge resolution failed");
    if (JSON.stringify(parseDocument("<<: 1").toJS()) !== '{"<<":1}') throw new Error("Core implicit merge key behavior changed");
    console.log("owned core known tags verified");
  `;
  const child = Bun.spawnSync([process.execPath, "--eval", program], {
    cwd: new URL("..", import.meta.url).pathname,
  });
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString().trim()).toBe("owned core known tags verified");
});
