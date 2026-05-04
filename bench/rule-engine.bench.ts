import { readFileSync } from "node:fs";
import path from "node:path";
import { bench, describe } from "vitest";
import { parseWorkflow } from "../src/workflow.ts";
import { evaluateRules } from "../src/rule-engine.ts";
import type { RepositorySignals } from "../src/repository-signals-types.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const emptyRepository: RepositorySignals = {
  hasSingleWorkflow: false,
  frameworks: [],
  linters: [],
  packageJsonHints: [],
  similarWorkflows: [],
};

const workflowPath = path.join(
  fixturesDir,
  "workflow-efficiency-like/.github/workflows/ci.yml",
);
const workflowSource = readFileSync(workflowPath, "utf8");
const parsed = parseWorkflow(workflowPath, fixturesDir, workflowSource);

const sampleRepoPath = path.join(
  fixturesDir,
  "sample-repo/.github/workflows/ci.yml",
);
const sampleRepoSource = readFileSync(sampleRepoPath, "utf8");
const sampleRepoParsed = parseWorkflow(
  sampleRepoPath,
  fixturesDir,
  sampleRepoSource,
);

describe("evaluateRules", () => {
  bench("workflow with findings (workflow-efficiency-like)", async () => {
    await evaluateRules(parsed, { repository: emptyRepository });
  });

  bench("simple workflow (sample-repo)", async () => {
    await evaluateRules(sampleRepoParsed, { repository: emptyRepository });
  });
});
