import { expect, test } from "bun:test";
import { parseWorkflow } from "../src/workflow.ts";
import { getRunsOnSpec, jobRunsOnBlacksmithRunner } from "../src/rules/shared/runs-on-facts.ts";
import { getStepFacts } from "../src/rules/shared/step-facts.ts";
import { stringify } from "yaml";

test.each([
  { label: "blacksmith-4vcpu-ubuntu-2404", os: "ubuntu", arch: "x64" },
  { label: "blacksmith-4vcpu-ubuntu-2604-arm;scheduling=flex", os: "ubuntu", arch: "arm" },
  { label: "blacksmith-4vcpu-windows-2025", os: "windows", arch: "x64" },
  { label: "blacksmith-6vcpu-macos-latest;scheduling=flex", os: "macos", arch: "arm" },
  { label: "blacksmith-12vcpu-macos-27", os: "macos", arch: "arm" },
])(
  "Blacksmith runner $label keeps provider, OS and native architecture distinct",
  ({ label, os, arch }) => {
    const workflow = parseWorkflow(
      "/repo/.github/workflows/ci.yml",
      "/repo",
      stringify({
        on: "push",
        jobs: { test: { "runs-on": label, steps: [] } },
      }),
    );
    const job = workflow.jobs[0]!;
    expect(jobRunsOnBlacksmithRunner(job)).toBe(true);
    expect(getRunsOnSpec(job)).toMatchObject({ os, arch, isStandardHosted: false });
  },
);

test.each(["ubuntu-latest", "${{ matrix.runner }}", "blacksmith-${{ inputs.size }}-ubuntu-2404"])(
  "unresolved or other provider runner is not statically Blacksmith: %s",
  (label) => {
    const workflow = parseWorkflow(
      "/repo/.github/workflows/ci.yml",
      "/repo",
      stringify({
        on: "push",
        jobs: { test: { "runs-on": label, steps: [] } },
      }),
    );
    expect(jobRunsOnBlacksmithRunner(workflow.jobs[0]!)).toBe(false);
  },
);

test("Blacksmith checkout preserves upstream depth/sparse/filter facts", () => {
  const workflow = parseWorkflow(
    "/repo/.github/workflows/ci.yml",
    "/repo",
    stringify({
      on: "push",
      jobs: {
        test: {
          "runs-on": "blacksmith",
          steps: [
            {
              uses: "useblacksmith/checkout@v1",
              with: {
                "fetch-depth": 0,
                "sparse-checkout": "src",
                filter: "blob:none",
              },
            },
          ],
        },
      },
    }),
  );
  expect(getStepFacts(workflow.jobs[0]!.steps[0]!)).toMatchObject({
    isCheckout: true,
    checkoutDepth: 0,
    checkoutSparseCheckout: "src",
    checkoutFilter: "blob:none",
  });
});
