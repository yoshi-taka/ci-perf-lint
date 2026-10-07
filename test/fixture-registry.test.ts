import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { fixtures } from "./fixtures.ts";

test("every registered fixture is an existing directory", async () => {
  const missing: string[] = [];
  await Promise.all(
    Object.entries(fixtures).map(async ([name, directory]) => {
      const info = await stat(directory).catch(() => undefined);
      if (!info?.isDirectory()) {
        missing.push(name);
      }
    }),
  );
  expect(missing.sort()).toEqual([]);
});
