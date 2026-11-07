import { afterAll } from "bun:test";
import fc from "fast-check";
import { clearTestCaches } from "./helpers.ts";

const fastCheckSeed = process.env.FAST_CHECK_SEED;
if (fastCheckSeed !== undefined && /^\d+$/.test(fastCheckSeed)) {
  // Deterministic in CI; the nightly fuzz workflow rotates this via run number.
  fc.configureGlobal({ seed: Number(fastCheckSeed) % 2 ** 31 });
}

const originalDisableEmbeddedOxlintPrewarm = process.env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM;

process.env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM = "1";

afterAll(() => {
  if (originalDisableEmbeddedOxlintPrewarm === undefined) {
    delete process.env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM;
  } else {
    process.env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM = originalDisableEmbeddedOxlintPrewarm;
  }
  clearTestCaches();
});
