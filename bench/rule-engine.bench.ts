import { readFileSync } from "node:fs";
import path from "node:path";
import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { parseWorkflow } from "../src/workflow.ts";
import { evaluateRules } from "../src/rule-engine.ts";
import type { RuleContext } from "../src/rule-engine.ts";
import type { WorkflowDocument } from "../src/workflow.ts";
import type { AnalysisWarning } from "../src/types.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { collectJobSummaries } from "../src/repository-similar-workflows-job-summaries.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const workflowPath = path.join(fixturesDir, "workflow-efficiency-like/.github/workflows/ci.yml");
const workflowSource = readFileSync(workflowPath, "utf8");
const parsed = parseWorkflow(
  workflowPath,
  path.join(fixturesDir, "workflow-efficiency-like"),
  workflowSource,
);

const sampleRepoPath = path.join(fixturesDir, "sample-repo/.github/workflows/ci.yml");
const sampleRepoSource = readFileSync(sampleRepoPath, "utf8");
const sampleRepoParsed = parseWorkflow(
  sampleRepoPath,
  path.join(fixturesDir, "sample-repo"),
  sampleRepoSource,
);

async function contextFor(workflow: WorkflowDocument, repoRoot: string): Promise<RuleContext> {
  const scanContext = new RepositoryScanContext(repoRoot, []);
  const { signals } = await collectRepositorySignals(
    repoRoot,
    [workflow],
    collectJobSummaries([workflow]),
    scanContext,
  );
  return { repository: signals, scanContext, allWorkflows: [workflow] };
}
const workflowContext = await contextFor(
  parsed,
  path.join(fixturesDir, "workflow-efficiency-like"),
);
const sampleContext = await contextFor(sampleRepoParsed, path.join(fixturesDir, "sample-repo"));

async function runRules(workflow: WorkflowDocument, context: RuleContext) {
  const warnings: AnalysisWarning[] = [];
  await evaluateRules(workflow, context, warnings);
  const failures = warnings.filter((warning) => warning.kind === "rule-error");
  if (failures.length > 0) throw new Error(failures.map((warning) => warning.message).join("\n"));
}
const bench = withCodSpeed(
  new Bench({
    iterations: 25,
    time: 0,
    warmup: false,
  }),
);

bench
  .add("evaluateRules > workflow with findings (workflow-efficiency-like)", async () => {
    await runRules(parsed, workflowContext);
  })
  .add("evaluateRules > simple workflow (sample-repo)", async () => {
    await runRules(sampleRepoParsed, sampleContext);
  });

export { bench };
