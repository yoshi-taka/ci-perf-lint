import { afterAll } from "bun:test";
import { clearTestCaches } from "./helpers.ts";

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
