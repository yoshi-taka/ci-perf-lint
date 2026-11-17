import { testTempRoot } from "./temp-root.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveTestCommands } from "../src/mutation/test-selection.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(testTempRoot(), "ci-perf-lint-selection-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return root;
}

describe("mutation test selection", () => {
  test("narrows commands through transitive local imports", async () => {
    const root = await project({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 2;\n",
      "test/helper.ts": 'import { b } from "../src/b.ts";\nexport const value = b;\n',
      "test/a.test.ts": 'import { a } from "../src/a.ts";\n',
      "test/b.test.ts": 'import { value } from "./helper.ts";\n',
      "test/both.test.ts": 'import { a } from "../src/a.ts";\nimport { b } from "../src/b.ts";\n',
    });
    const command = "bun test test/a.test.ts test/b.test.ts test/both.test.ts";
    const commands = await deriveTestCommands(command, ["src/a.ts", "src/b.ts"], root);
    expect(commands.get("src/a.ts")).toBe("bun test test/a.test.ts test/both.test.ts");
    expect(commands.get("src/b.ts")).toBe("bun test test/b.test.ts test/both.test.ts");
  });

  test("keeps the original command when no test imports the target", async () => {
    const root = await project({
      "src/a.ts": "export const a = 1;\n",
      "src/orphan.ts": "export const orphan = 1;\n",
      "test/a.test.ts": 'import { a } from "../src/a.ts";\n',
    });
    const command = "bun test test/a.test.ts";
    const commands = await deriveTestCommands(command, ["src/a.ts", "src/orphan.ts"], root);
    expect(commands.get("src/a.ts")).toBe(command);
    expect(commands.get("src/orphan.ts")).toBe(command);
  });

  test("supports commands without explicit test files", async () => {
    const root = await project({
      "src/a.ts": "export const a = 1;\n",
      "test/a.test.ts": 'import { a } from "../src/a.ts";\n',
    });
    const commands = await deriveTestCommands("bun run test:shell-evidence", ["src/a.ts"], root);
    expect(commands.get("src/a.ts")).toBe("bun run test:shell-evidence");
  });
});
