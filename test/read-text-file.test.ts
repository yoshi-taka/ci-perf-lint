import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { readTextFile } from "../src/read-text-file.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("readTextFile", () => {
  test("reads file content as string", async () => {
    const repoRoot = await tempDirs.create("read-text-");
    const fp = path.join(repoRoot, "test.txt");
    await writeFile(fp, "hello world");
    expect(await readTextFile(fp)).toBe("hello world");
  });

  test("reads empty file", async () => {
    const repoRoot = await tempDirs.create("read-text-");
    const fp = path.join(repoRoot, "empty.txt");
    await writeFile(fp, "");
    expect(await readTextFile(fp)).toBe("");
  });

  test("reads UTF-8 content", async () => {
    const repoRoot = await tempDirs.create("read-text-");
    const fp = path.join(repoRoot, "utf8.txt");
    await writeFile(fp, "日本語 👍");
    expect(await readTextFile(fp)).toBe("日本語 👍");
  });

  test("rejects on non-existent file", async () => {
    await expect(readTextFile("/tmp/non-existent-opencode-test-12345")).rejects.toThrow();
  });
});
