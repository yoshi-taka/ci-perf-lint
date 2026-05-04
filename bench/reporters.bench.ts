import path from "node:path";
import { Bench } from "tinybench";
import { analyzeRepository } from "../src/repo.ts";
import { renderReport } from "../src/reporters-render.ts";
import type { ReportData } from "../src/types.ts";

const fixturesDir = path.resolve(import.meta.dirname, "../test/fixtures");

const reportData: ReportData = await analyzeRepository({
  cwd: fixturesDir,
  targetPath: path.join(fixturesDir, "dd-trace-js"),
  topCount: 5,
  mode: "strict",
  workflowOnly: true,
});

const bench = new Bench();

bench
  .add("renderReport > handoff format", () => {
    renderReport(reportData, "handoff", { topCount: 5, mode: "strict" });
  })
  .add("renderReport > text format", () => {
    renderReport(reportData, "text", { topCount: 5, mode: "strict" });
  })
  .add("renderReport > json format", () => {
    renderReport(reportData, "json", { topCount: 5, mode: "strict" });
  })
  .add("renderReport > markdown format", () => {
    renderReport(reportData, "markdown", { topCount: 5, mode: "strict" });
  });

export { bench };
