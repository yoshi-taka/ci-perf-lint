import { expect, test } from "bun:test";
import { stringify } from "yaml";
import { parseWorkflow } from "../src/workflow.ts";
import {
  getRunsOnSpec,
  jobRunsOnBlacksmithRunner,
  jobRunsOnDepotRunner,
} from "../src/rules/shared/runs-on-facts.ts";

function jobFor(label: string) {
  const workflow = parseWorkflow(
    "/repo/.github/workflows/ci.yml",
    "/repo",
    stringify({
      on: "push",
      jobs: { test: { "runs-on": label, steps: [] } },
    }),
  );
  return workflow.jobs[0]!;
}

test.each([
  { label: "depot-ubuntu-24.04", os: "ubuntu", arch: "x64" },
  { label: "depot-ubuntu-24.04-arm-8", os: "ubuntu", arch: "arm" },
  { label: "depot-ubuntu-22.04-arm", os: "ubuntu", arch: "arm" },
  { label: "depot-windows-2025-4", os: "windows", arch: "x64" },
  { label: "depot-macos-15", os: "macos", arch: "arm" },
  { label: "depot-macos-latest", os: "macos", arch: "arm" },
])(
  "Depot runner $label keeps provider, OS and native architecture distinct",
  ({ label, os, arch }) => {
    const job = jobFor(label);
    expect(jobRunsOnDepotRunner(job)).toBe(true);
    expect(jobRunsOnBlacksmithRunner(job)).toBe(false);
    expect(getRunsOnSpec(job)).toMatchObject({ os, arch, isStandardHosted: false });
  },
);

test.each(["ubuntu-latest", "${{ matrix.runner }}", "depot-${{ inputs.os }}-arm"])(
  "unresolved or other provider runner is not statically Depot: %s",
  (label) => {
    expect(jobRunsOnDepotRunner(jobFor(label))).toBe(false);
  },
);
