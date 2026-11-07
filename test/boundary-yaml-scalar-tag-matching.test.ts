import { expect, test } from "bun:test";
import { parseDocument } from "../src/yaml.ts";

test("scalar tag selection no longer executes native test patterns", () => {
  // Shared native schema records must only be poisoned in a separate process.
  const program = `
    import {parseDocument as native} from "yaml";
    import {parseDocument} from ${JSON.stringify(new URL("../src/yaml.ts", import.meta.url).href)};
    const schemas = [native("x").schema, native("%YAML 1.1\\n---\\nx").schema];
    for (const schema of schemas) for (const tag of schema.tags) {
      if (tag.test) {
        tag.test.test = () => {throw new Error("Native tag test called");};
        tag.test.exec = () => {throw new Error("Native tag exec called");};
      }
    }
    const core = parseDocument("[null, TRUE, 0o17, 0x2a, 1.200, 1e3, yes, 2026-11-07]");
    if (core.errors.length || JSON.stringify(core.toJS()) !== '[null,true,15,42,1.2,1000,"yes","2026-11-07"]') throw new Error("Core tag substitution failed");
    const legacy = parseDocument("%YAML 1.1\\n---\\nbase: &base {x: 42}\\ncopy: {<<: *base}\\nvalues: [yes, NO, 012, 0b1010, 0:0, 00:01, -0:21, 2026-11-07]\\n");
    if (legacy.errors.length) throw new Error("Legacy tag substitution failed");
    const value = legacy.toJS();
    if (value.copy.x !== 42 || JSON.stringify(value.values.slice(0, 7)) !== '[true,false,10,10,0,1,-21]' || !(value.values[7] instanceof Date)) throw new Error("Unexpected legacy tag selection");
    console.log("owned scalar tests verified");
  `;
  const child = Bun.spawnSync([process.execPath, "--eval", program], {
    cwd: new URL("..", import.meta.url).pathname,
  });
  expect(child.stderr.toString()).toBe("");
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString().trim()).toBe("owned scalar tests verified");
});

test("zero-leading YAML 1.1 sexagesimal integers retain observed compatibility behavior", () => {
  // Keep native compatibility even where a narrower spec-only implementation differs.
  const document = parseDocument("%YAML 1.1\n---\n[0:0, 00:01, -0:21, 0_:59, 0:60]");
  expect(document.errors).toEqual([]);
  expect(document.toJS()).toEqual([0, 1, -21, 59, "0:60"]);
});
