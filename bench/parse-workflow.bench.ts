import { readFileSync } from "node:fs";
import path from "node:path";
import { bench, describe } from "vitest";
import { parseWorkflow } from "../src/workflow.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const smallWorkflowPath = path.join(
  fixturesDir,
  "sample-repo/.github/workflows/ci.yml",
);
const smallWorkflowSource = readFileSync(smallWorkflowPath, "utf8");

const mediumWorkflowPath = path.join(
  fixturesDir,
  "workflow-efficiency-like/.github/workflows/ci.yml",
);
const mediumWorkflowSource = readFileSync(mediumWorkflowPath, "utf8");

const largeWorkflowPath = path.join(
  fixturesDir,
  "dd-trace-js/.github/workflows/test-optimization.yml",
);
const largeWorkflowSource = readFileSync(largeWorkflowPath, "utf8");

describe("parseWorkflow", () => {
  bench("small workflow (sample-repo ci.yml)", () => {
    parseWorkflow(smallWorkflowPath, fixturesDir, smallWorkflowSource);
  });

  bench("medium workflow (workflow-efficiency-like ci.yml)", () => {
    parseWorkflow(mediumWorkflowPath, fixturesDir, mediumWorkflowSource);
  });

  bench("large workflow (dd-trace-js test-optimization.yml)", () => {
    parseWorkflow(largeWorkflowPath, fixturesDir, largeWorkflowSource);
  });
});
