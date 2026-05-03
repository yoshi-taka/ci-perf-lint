import { describe, expect, test } from "bun:test";
import { extractQuotedJobName } from "../src/shared/message-parsing.ts";
import {
  jobRunsOnStandardHostedRunner,
  setupActionHasBuiltInCacheForFamily,
} from "../src/rules/shared/workflows.ts";
import { createWorkflowJob, createWorkflowStep } from "./helpers.ts";

describe("extractQuotedJobName", () => {
  test("extracts quoted job names regardless of message casing", () => {
    for (const message of [
      'job "build-layer" does not define job-level timeout-minutes.',
      'Job "build-layer" does not define job-level timeout-minutes.',
      'JOB "build-layer" does not define job-level timeout-minutes.',
    ]) {
      expect(extractQuotedJobName(message)).toBe("build-layer");
    }
  });
});

describe("shared workflow case handling", () => {
  test.each([
    ["single mixed-case label", true, "Ubuntu-24.04"],
    ["mixed standard and architecture labels", false, ["Ubuntu-24.04", "X64"]],
    ["mixed standard labels", true, ["Ubuntu-24.04", "ubuntu-latest"]],
  ] as const)("hosted runner labels: %s -> %p", (_name, expected, runsOn) => {
    expect(jobRunsOnStandardHostedRunner(createWorkflowJob({ "runs-on": runsOn }))).toBe(expected);
  });

  test.each([
    ["actions/setup-node@v4", { cache: "PNPM" }, "pnpm"],
    ["ruby/setup-ruby@v1", { "bundler-cache": "True" }, "bundler"],
    ["actions/setup-dotnet@v4", { cache: "TRUE" }, "nuget"],
  ] as const)("built-in cache value for %s", (uses, withValue, family) => {
    expect(
      setupActionHasBuiltInCacheForFamily(createWorkflowStep({ uses, with: withValue }), family),
    ).toBe(true);
  });
});
