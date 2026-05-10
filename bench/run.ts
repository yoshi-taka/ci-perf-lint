import { withCodSpeed } from "@codspeed/tinybench-plugin";
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
      const wrapped = withCodSpeed(bench);
      await wrapped.run();
      console.table(wrapped.table());
    } catch (error) {
      console.error(`[bench] Skipping failed benchmark: ${error}`);
    }
  }
}

main();
