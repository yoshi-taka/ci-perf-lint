import { expect, test } from "bun:test";
import path from "node:path";

// Isolate the instrumentation mock from the rest of the suite. The real plugin,
// benchmark callbacks and failure checks run unchanged. The benchmarks themselves
// run in the CodSpeed workflow, not here.
const simulationSetup = String.raw`
  import assert from "node:assert/strict";
  import { mock } from "bun:test";
  import { Bench } from "tinybench";
  const executed = [];
  const actual = await import("@codspeed/core");
  mock.module("@codspeed/core", () => ({
    ...actual,
    getCodspeedRunnerMode: () => "simulation",
    getInstrumentMode: () => "analysis",
    tryIntrospect: () => {},
    getCallingFile: () => "/codspeed-smoke.bench.ts",
    setupCore: () => {}, teardownCore: () => {},
    optimizeFunction: async (fn) => fn(),
    wrapWithRootFrame: (fn) => fn,
    mongoMeasurement: { start: async () => {}, stop: async () => {} },
    InstrumentHooks: {
      isInstrumented: () => false,
      startBenchmark: () => {}, stopBenchmark: () => {},
      setExecutedBenchmark: (_pid, uri) => { executed.push(uri); },
    },
  }));
  process.env.CODSPEED_ENV = "1";
  process.env.CODSPEED_RUNNER_MODE = "simulation";
  const { withCodSpeed } = await import("@codspeed/tinybench-plugin");
  const { failedBenchmarkTasks } = await import("./bench/benchmark-results.ts");
`;

const script =
  simulationSetup +
  String.raw`
  let calls = 0;
  const success = withCodSpeed(new Bench({ iterations: 1, time: 0, warmup: false }));
  success.add("smoke", () => { calls++; });
  await success.run();
  assert.ok(calls > 0);
  assert.equal(success.tasks[0].result.state, "not-started");
  assert.deepEqual(failedBenchmarkTasks(success, true), []);
  assert.deepEqual(failedBenchmarkTasks(success), ["smoke"]);
  const failure = withCodSpeed(new Bench({ iterations: 1, time: 0, warmup: false }));
  failure.add("failure", () => { throw new Error("benchmark failed"); });
  await assert.rejects(failure.run(), /benchmark failed/);
  const late = new Bench({ iterations: 1, time: 0, warmup: false });
  late.add("late", () => {});
  withCodSpeed(late);
  await assert.rejects(late.run(), /No captured function/);
  console.log("codspeed harness ok");
`;

test("CodSpeed simulation handles registration, statistics and runner failure", async () => {
  const root = path.resolve(import.meta.dir, "..");
  const child = Bun.spawn(["bun", "-e", script], {
    cwd: root,
    env: { ...globalThis.process.env, AGENT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("codspeed harness ok");
});

const shardScript =
  simulationSetup +
  String.raw`
  const repo = await import("./src/repo.ts");
  const sample = await repo.analyzeRepository({
    cwd: process.cwd(), targetPath: "test/fixtures/sample-repo",
    mode: "strict", workflowOnly: true, topCount: 5,
  });
  const targets = [];
  mock.module("./src/repo.ts", () => ({
    ...repo,
    analyzeRepository: async (options) => {
      if (options.cwd.startsWith("/tmp/")) {
        targets.push(options.cwd);
        if (options.cwd === process.env.FAIL_TARGET) {
          throw new Error("injected target failure");
        }
      }
      return sample;
    },
  }));
  await import("./bench/run.ts");
  console.log("SHARD_RESULT=" + JSON.stringify({ executed, targets }));
`;

async function runShard(shard: string | undefined, failTarget = "") {
  const env: Record<string, string | undefined> = {
    ...process.env,
    AGENT: "1",
    FAIL_TARGET: failTarget,
  };
  if (shard === undefined) {
    delete env.BENCH_SHARD;
  } else {
    env.BENCH_SHARD = shard;
  }
  const child = Bun.spawn(["bun", "-e", shardScript], {
    cwd: path.resolve(import.meta.dir, ".."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("CodSpeed shards partition the original benchmark identities exactly once", async () => {
  const names: string[] = [];
  let all: string[] = [];
  for (const shard of [undefined, "micro", "opencode", "oxc", "pytorch"]) {
    const result = await runShard(shard);
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" });
    const line = result.stdout.split("\n").find((text) => text.startsWith("SHARD_RESULT="));
    expect(line).toBeDefined();
    const data = JSON.parse(line!.slice("SHARD_RESULT=".length)) as {
      executed: string[];
      targets: string[];
    };
    expect(new Set(data.executed).size).toBe(data.executed.length);
    if (shard === undefined) {
      all = data.executed;
      expect(all).toHaveLength(36);
    } else {
      names.push(...data.executed);
      expect(result.stdout).toContain(`[bench] End shard=${shard} elapsed_ms=`);
      const targetsByShard: Record<string, string[]> = {
        micro: [],
        opencode: ["/tmp/ts-target"],
        oxc: ["/tmp/rs-target"],
        pytorch: ["/tmp/py-target"],
      };
      const expected = targetsByShard[shard] ?? [];
      expect([...new Set(data.targets)]).toEqual(expected);
      expect(data.executed).toHaveLength(shard === "micro" ? 33 : 1);
    }
  }
  expect(names.toSorted()).toEqual(all.toSorted());
  expect(new Set(names).size).toBe(names.length);
}, 30000);

test("CodSpeed shards reject invalid selections and propagate target failures", async () => {
  const invalid = await runShard("typo");
  expect(invalid.code).not.toBe(0);
  expect(invalid.stderr).toContain("Unknown CodSpeed shard: typo");
  const failed = await runShard("pytorch", "/tmp/py-target");
  expect(failed.code).not.toBe(0);
  expect(failed.stderr).toContain("injected target failure");
}, 15000);
