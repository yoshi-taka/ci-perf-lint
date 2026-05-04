import path from "node:path";
import { bench, describe } from "vitest";
import { analyzeRepository } from "../src/repo.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

describe("analyzeRepository", () => {
  bench("sample-repo (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "sample-repo"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  });

  bench("workflow-efficiency-like (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "workflow-efficiency-like"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  });

  bench("dd-trace-js (workflow-only)", async () => {
    await analyzeRepository({
      cwd: fixturesDir,
      targetPath: path.join(fixturesDir, "dd-trace-js"),
      topCount: 5,
      mode: "strict",
      workflowOnly: true,
    });
  });
});
