import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { collectWorkflowFiles, resolveWorkflowTarget } from "../src/fs.ts";

test("all checked-in CI fixtures are syntactically valid", async () => {
  const root = path.join(import.meta.dir, "fixtures");
  const entries = await readdir(root, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const files = await collectWorkflowFiles(
      await resolveWorkflowTarget(path.join(root, entry.name)),
    );
    for (const file of files) {
      const doc = parseDocument(await readFile(file, "utf8"));
      expect(doc.errors.map((error) => `${file}: ${error.message}`)).toEqual([]);
      count++;
    }
  }
  expect(count).toBeGreaterThan(0);
});
