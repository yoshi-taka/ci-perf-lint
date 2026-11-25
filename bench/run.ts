import { failedBenchmarkTasks } from "./benchmark-results.ts";
import type { Bench } from "tinybench";
import { benchmarkShard, includesBenchmarkShard } from "./shards.ts";

async function main() {
  const benches: Bench[] = [];
  if (includesBenchmarkShard("micro")) {
    benches.push(
      (await import("./parse-workflow.bench.ts")).bench,
      (await import("./rule-engine.bench.ts")).bench,
    );
  }
  benches.push((await import("./analyze-repository.bench.ts")).bench);
  if (includesBenchmarkShard("micro")) {
    benches.push(
      (await import("./reporters.bench.ts")).bench,
      (await import("./tool-presence.bench.ts")).bench,
      (await import("./step-proximity.bench.ts")).bench,
      (await import("./dockerfile-parser.bench.ts")).bench,
    );
  }

  for (const bench of benches) {
    if (bench.tasks.length === 0) {
      throw new Error(`No benchmarks registered for shard ${benchmarkShard}`);
    }
    const names = bench.tasks.map((task) => task.name).join(", ");
    console.log(`[bench] Start shard=${benchmarkShard}: ${names}`);
    const startedAt = performance.now();
    try {
      await bench.run();
      const analysisCompleted =
        process.env.CODSPEED_ENV !== undefined &&
        ["simulation", "instrumentation", "memory"].includes(
          process.env.CODSPEED_RUNNER_MODE ?? "",
        );
      if (!analysisCompleted) {
        console.table(bench.table());
      }
      const failed = failedBenchmarkTasks(bench, analysisCompleted);
      if (failed.length > 0) {
        console.error(`[bench] Failed tasks: ${failed.join(", ")}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`[bench] Skipping failed benchmark: ${error}`);
      process.exitCode = 1;
    } finally {
      console.log(
        `[bench] End shard=${benchmarkShard} elapsed_ms=${Math.round(performance.now() - startedAt)}: ${names}`,
      );
    }
  }
}

await main();
