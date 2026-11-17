import { expect, test } from "bun:test";

test("reporters fuzz target ignores non-object JSON", async () => {
  const manifest = await import("../fuzz/reporters.fuzz.mjs");
  for (const input of ["null", "[]", "1", '"text"', "true"]) {
    expect(() => manifest.fuzz(Buffer.from(input))).not.toThrow();
  }
});
