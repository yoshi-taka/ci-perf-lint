import path from "node:path";
import { bench, describe, beforeAll } from "vitest";
import { analyzeRepository } from "../src/repo.ts";
import { renderReport } from "../src/reporters-render.ts";
import type { ReportData } from "../src/types.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

let reportData: ReportData;

beforeAll(async () => {
  reportData = await analyzeRepository({
    cwd: fixturesDir,
    targetPath: path.join(fixturesDir, "dd-trace-js"),
    topCount: 5,
    mode: "strict",
    workflowOnly: true,
  });
});

describe("renderReport", () => {
  bench("handoff format", () => {
    renderReport(reportData, "handoff", { topCount: 5, mode: "strict" });
  });

  bench("text format", () => {
    renderReport(reportData, "text", { topCount: 5, mode: "strict" });
  });

  bench("json format", () => {
    renderReport(reportData, "json", { topCount: 5, mode: "strict" });
  });

  bench("markdown format", () => {
    renderReport(reportData, "markdown", { topCount: 5, mode: "strict" });
  });
});
