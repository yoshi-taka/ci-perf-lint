import { expect, test } from "bun:test";
import path from "node:path";

// Isolate the instrumentation mock from the rest of the suite. The real plugin,
// benchmark callbacks and failure checks run unchanged. The benchmarks themselves
// run in the CodSpeed workflow, not here.
const script = String.raw`
  import assert from "node:assert/strict";
  import { mock } from "bun:test";
  import { Bench } from "tinybench";
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
      setExecutedBenchmark: () => {},
    },
  }));
  process.env.CODSPEED_ENV = "1";
  process.env.CODSPEED_RUNNER_MODE = "simulation";
  const { withCodSpeed } = await import("@codspeed/tinybench-plugin");
  const { failedBenchmarkTasks } = await import("./bench/benchmark-results.ts");
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
