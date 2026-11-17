import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFile } from "node:fs/promises";
import path from "node:path";

const allowed = new Set(["test/temp-root.ts", "test/test-temp-root.test.ts"]);
const forbidden = /\b(?:os\.)?tmpdir\s*\(/;

test("test sources use the runner-owned temp root", async () => {
  const root = path.resolve(import.meta.dir, "..");
  const offenders: string[] = [];
  for (const file of new Glob("test/**/*.ts").scanSync({ cwd: root })) {
    if (allowed.has(file) || file.includes("fixtures/")) {
      continue;
    }
    const text = await readFile(path.join(root, file), "utf8");
    if (forbidden.test(text)) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
