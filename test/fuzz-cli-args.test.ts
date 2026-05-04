import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parseArgs } from "../src/main.ts";

describe("fuzz: parseArgs", () => {
  test("either parses or throws typed CLI errors", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 12 }), (args) => {
        try {
          const parsed = parseArgs(args);
          if (parsed !== null) {
            expect(parsed.top).toBeGreaterThan(0);
            expect(["handoff", "text", "json", "markdown"]).toContain(parsed.format);
            expect(["strict", "exploratory"]).toContain(parsed.mode);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 500, interruptAfterTimeLimit: 10000 },
    );
  }, 15000);
});
