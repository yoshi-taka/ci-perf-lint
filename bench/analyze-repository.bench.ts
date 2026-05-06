import path from "node:path";
import { Bench } from "tinybench";
import { analyzeRepository } from "../src/repo.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const bench = new Bench({
  iterations: 1,
  time: 0,
  warmup: false,
});

bench
  .add("analyzeRepository > sample-repo (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "sample-repo"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  })
  .add("analyzeRepository > workflow-efficiency-like (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "workflow-efficiency-like"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  })
  .add("analyzeRepository > dd-trace-js (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "dd-trace-js"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  })
  .add("analyzeRepository > opencode (full)", async () => {
    await analyzeRepository({
      cwd: "/tmp/ts-target",
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });
  })
  .add("analyzeRepository > oxc (full)", async () => {
    await analyzeRepository({
      cwd: "/tmp/rs-target",
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });
  })
  .add("analyzeRepository > pytorch (full)", async () => {
    await analyzeRepository({
      cwd: "/tmp/py-target",
      targetPath: ".",
      topCount: 5,
      mode: "strict",
    });
  });

export { bench };
