import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { collectWorkflowInputs, resolveWorkflowTarget } from "../src/fs.ts";
import { parseCiYaml } from "../src/ci-yaml.ts";

test("all checked-in CI fixtures are syntactically valid", async () => {
  const root = path.join(import.meta.dir, "fixtures");
  const entries = await readdir(root, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const files = await collectWorkflowInputs(
      await resolveWorkflowTarget(path.join(root, entry.name)),
    );
    for (const file of files) {
      const source = await readFile(file.path, "utf8");
      const doc = parseDocument(source, {
        merge: ["circleci", "buildkite", "gitlab-ci"].includes(file.kind),
      });
      expect(doc.errors.map((error) => `${file.path}: ${error.message}`)).toEqual([]);
      const ciDocument = parseCiYaml(source, file.kind);
      expect(ciDocument.errors.map((error) => `${file.path}: ${error.message}`)).toEqual([]);
      count++;
    }
  }
  expect(count).toBeGreaterThan(0);
});
