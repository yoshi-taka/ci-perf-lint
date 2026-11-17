import { afterAll } from "bun:test";
import { rmSync } from "node:fs";
import { testTempRoot } from "./temp-root.ts";
import fc from "fast-check";
import { clearTestCaches } from "./helpers.ts";

const fastCheckSeed = process.env.FAST_CHECK_SEED;
if (fastCheckSeed !== undefined && /^\d+$/.test(fastCheckSeed)) {
  // Deterministic in CI; the nightly fuzz workflow rotates this via run number.
  fc.configureGlobal({ seed: Number(fastCheckSeed) % 2 ** 31 });
}

afterAll(() => {
  clearTestCaches();
  rmSync(testTempRoot(), { recursive: true, force: true });
});
