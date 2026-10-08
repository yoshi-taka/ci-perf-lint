import { expect, test } from "bun:test";
import path from "node:path";

test.each([false, true])(
  "CodSpeed simulation handles registration, statistics and runner failure=%s",
  async (injectFailure) => {
    const root = path.resolve(import.meta.dir, "..");
    // Isolate the instrumentation mock from the rest of the suite. The real plugin,
    // benchmark registrations, callbacks, runner and failure checks run unchanged.
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
    const { bench } = await import("./bench/analyze-repository.bench.ts");
    // Production still runs all three freshly cloned repositories. This smoke
    // verifies the fixture cases without requiring network clones in unit tests.
    for (const name of ["opencode", "oxc", "pytorch"]) {
      bench.remove("analyzeRepository > " + name + " (full)");
    }
    if (process.env.CODSPEED_SMOKE_FAIL === "1") {
      bench.add("injected failure", () => { throw new Error("injected benchmark failure"); });
    }
    await import("./bench/run.ts");
  `;
    const process = Bun.spawn(["bun", "-e", script], {
      cwd: root,
      env: {
        ...globalThis.process.env,
        AGENT: "1",
        CODSPEED_SMOKE_FAIL: injectFailure ? "1" : "0",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (injectFailure) {
      expect(code).toBe(1);
      expect(stderr).toContain("injected benchmark failure");
    } else {
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    }
    expect(stdout).toContain("Done running");
    expect(stdout).toContain("evaluateRules > simple workflow");
    expect(stdout).toContain("renderReport > markdown format");
    expect(stdout).toContain("computePairProximity > cross-job pairs only");
  },
  15000,
);
