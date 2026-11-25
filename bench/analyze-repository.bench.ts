import path from "node:path";
import { Bench } from "tinybench";
import { withCodSpeed } from "@codspeed/tinybench-plugin";
import { analyzeRepository } from "../src/repo.ts";
import { includesBenchmarkShard, type BenchmarkShard } from "./shards.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const bench = withCodSpeed(new Bench({ iterations: 1, time: 0, warmup: false }));

function add(shard: BenchmarkShard, name: string, run: () => Promise<void>) {
  if (includesBenchmarkShard(shard)) {
    bench.add(name, run);
  }
}

add("micro", "analyzeRepository > sample-repo (workflow-only)", async () => {
  await analyzeRepository({
    cwd: fixturesDir,
    targetPath: path.join(fixturesDir, "sample-repo"),
    topCount: 5,
    mode: "strict",
    workflowOnly: true,
  });
});
add("micro", "analyzeRepository > workflow-efficiency-like (workflow-only)", async () => {
  await analyzeRepository({
    cwd: fixturesDir,
    targetPath: path.join(fixturesDir, "workflow-efficiency-like"),
    topCount: 5,
    mode: "strict",
    workflowOnly: true,
  });
});
add("micro", "analyzeRepository > dd-trace-js (workflow-only)", async () => {
  await analyzeRepository({
    cwd: fixturesDir,
    targetPath: path.join(fixturesDir, "dd-trace-js"),
    topCount: 5,
    mode: "strict",
    workflowOnly: true,
  });
});
add("opencode", "analyzeRepository > opencode (full)", async () => {
  await analyzeRepository({
    cwd: "/tmp/ts-target",
    targetPath: ".",
    topCount: 5,
    mode: "strict",
  });
});
add("oxc", "analyzeRepository > oxc (full)", async () => {
  await analyzeRepository({
    cwd: "/tmp/rs-target",
    targetPath: ".",
    topCount: 5,
    mode: "strict",
  });
});
add("pytorch", "analyzeRepository > pytorch (full)", async () => {
  await analyzeRepository({
    cwd: "/tmp/py-target",
    targetPath: ".",
    topCount: 5,
    mode: "strict",
  });
});

export { bench };
