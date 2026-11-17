import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isJsonObject, parseJsonObject } from "../src/fuzz/json.ts";

const manifestDir = path.join(import.meta.dir, "../fuzz");

test("isJsonObject accepts only plain JSON objects", () => {
  for (const input of [null, true, false, 0, -1.5, "", "x", [], [1, null], [[{}]]]) {
    expect(isJsonObject(input)).toBe(false);
  }
  for (const input of [{}, { findings: [] }, { a: { b: null } }]) {
    expect(isJsonObject(input)).toBe(true);
  }
});

test("parseJsonObject rejects invalid JSON and non-object JSON", () => {
  for (const input of ["", "undefined", "{", "nul", '{"a":}', "[1,]"]) {
    expect(parseJsonObject(input)).toBeUndefined();
  }
  for (const input of ["null", "true", "0", '"x"', "[]", "[{}]"]) {
    expect(parseJsonObject(input)).toBeUndefined();
  }
  expect(parseJsonObject('{"findings":[]}')).toEqual({ findings: [] });
});

test("fuzz manifests parse JSON only through parseJsonObject", () => {
  const manifests = readdirSync(manifestDir).filter((entry) => entry.endsWith(".fuzz.mjs"));
  expect(manifests.length).toBeGreaterThan(0);
  for (const manifest of manifests) {
    const source = readFileSync(path.join(manifestDir, manifest), "utf8");
    expect(source.includes("JSON.parse(")).toBe(false);
  }
  const reporters = readFileSync(path.join(manifestDir, "reporters.fuzz.mjs"), "utf8");
  expect(reporters).toContain("parseJsonObject");
});
