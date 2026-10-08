import { failedBenchmarkTasks } from "./benchmark-results.ts";
import { bench as parseWorkflowBench } from "./parse-workflow.bench.ts";
import { bench as ruleEngineBench } from "./rule-engine.bench.ts";
import { bench as analyzeRepositoryBench } from "./analyze-repository.bench.ts";
import { bench as reportersBench } from "./reporters.bench.ts";
import { bench as toolPresenceBench } from "./tool-presence.bench.ts";
import { bench as stepProximityBench } from "./step-proximity.bench.ts";

async function main() {
  const benches = [
    parseWorkflowBench,
    ruleEngineBench,
    analyzeRepositoryBench,
    reportersBench,
    toolPresenceBench,
    stepProximityBench,
  ];

  for (const bench of benches) {
    try {
      await bench.run();
      const analysisCompleted =
        process.env.CODSPEED_ENV !== undefined &&
        ["simulation", "instrumentation", "memory"].includes(
          process.env.CODSPEED_RUNNER_MODE ?? "",
        );
      if (!analysisCompleted) console.table(bench.table());
      const failed = failedBenchmarkTasks(bench, analysisCompleted);
      if (failed.length > 0) {
        console.error(`[bench] Failed tasks: ${failed.join(", ")}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`[bench] Skipping failed benchmark: ${error}`);
      process.exitCode = 1;
    }
  }
}

main();
