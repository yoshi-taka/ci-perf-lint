import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument as referenceParse } from "yaml";
import { parseDocument } from "../src/yaml.ts";

function converted(run: () => unknown): unknown {
  try {
    return { value: run() };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

test("real YAML fixtures retain node/document conversion and error behavior", () => {
  const root = path.resolve(import.meta.dir, "fixtures");
  let count = 0;
  for (const relative of new Bun.Glob("**/*.{yaml,yml}").scanSync({
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (relative.split(path.sep).includes("node_modules")) {
      continue;
    }
    const source = readFileSync(path.join(root, relative), "utf8");
    const reference = referenceParse(source);
    const candidate = parseDocument(source);
    expect({ file: relative, codes: candidate.errors.map((error) => error.code) }).toEqual({
      file: relative,
      codes: reference.errors.map((error) => error.code),
    });
    expect({ file: relative, result: converted(() => candidate.contents?.toJSON()) }).toEqual({
      file: relative,
      result: converted(() => reference.contents?.toJSON()),
    });
    expect({ file: relative, result: converted(() => candidate.toJS()) }).toEqual({
      file: relative,
      result: converted(() => reference.toJS()),
    });
    count++;
  }
  expect(count).toBeGreaterThan(0);
});
