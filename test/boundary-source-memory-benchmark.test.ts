import { expect, test } from "bun:test";
import path from "node:path";
import { assertOutsideTarget, parseMemoryOptions } from "../bench/source-memory/options.ts";
import {
  createMemoryScenarios,
  memoryScenarioNames,
  sourceMemoryFiles,
} from "../bench/source-memory/scenarios.ts";
import {
  median,
  memoryRows,
  memoryTree,
  treeSamplingLimited,
  validateMemoryOutput,
} from "../bench/source-memory/measure.ts";
import type { MemoryVariant } from "../bench/source-memory/types.ts";
import { collectSourceAudit } from "../src/repository-diagnostics/source-audit.ts";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { createTempDirTracker } from "./helpers.ts";

const dirs = createTempDirTracker();
test("importing the benchmark entrypoint does not launch a run or change exit status", async () => {
  const status = process.exitCode;
  await import("../bench/source-memory/run.ts");
  expect(process.exitCode).toBe(status);
});
test("memory options have bounded defaults and support future native comparisons", () => {
  const options = parseMemoryOptions(["--", "--before", "HEAD", "--after", "HEAD", "--runs", "1"]);
  expect(options).toMatchObject({
    before: "HEAD",
    after: "HEAD",
    runs: 1,
    components: 600,
    projects: 128,
    memoryMiB: 1536,
  });
  expect(parseMemoryOptions(["--help"]).help).toBe(true);
  expect(parseMemoryOptions(["--target", "repo"], "/base").target).toBe(path.resolve("/base/repo"));
});
test.each(
  [
    ["--runs", "0"],
    ["--runs", "1.5"],
    ["--runs", "11"],
    ["--components", "10001"],
    ["--projects", "501"],
    ["--memory-mib", "1793"],
    ["--timeout-ms", "0"],
    ["--runs"],
    ["--unknown", "x"],
    ["--runs", "1", "--runs", "2"],
    ["--cases", "a,a"],
    ["--cases", "a,"],
    ["--target", "x", "--cases", "components-ts"],
  ].map((args) => ({ args })),
)("memory options reject unsafe/ambiguous inputs: %j", ({ args }) => {
  expect(() => parseMemoryOptions(args)).toThrow();
});
test("benchmark directories cannot be inside the target, but sibling prefixes are fine", () => {
  expect(() => assertOutsideTarget("/target", "/target")).toThrow();
  expect(() => assertOutsideTarget("/target/results", "/target")).toThrow();
  expect(() => assertOutsideTarget("/target-other/results", "/target")).not.toThrow();
});
test("memory aggregation excludes the guardian, retains detached descendants and terminates on cycles", () => {
  const rows = memoryRows(
    "1 0 1 999 guardian\n2 1 2 10 /usr/bin/time -l node\n4 3 4 30 node oxlint\n3 2 3 20 node\n5 1 1 999 ps\n",
  );
  expect(memoryTree(rows, 2).reduce((sum, row) => sum + row.kib, 0)).toBe(60);
  expect(
    memoryTree(
      [
        { pid: 2, parent: 3, kib: 10, command: "a" },
        { pid: 3, parent: 2, kib: 20, command: "b" },
      ],
      2,
    ),
  ).toHaveLength(2);
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 2])).toBe(3);
  expect(() => median([])).toThrow();
  expect(() => median([NaN])).toThrow();
  expect(treeSamplingLimited(42 * 1024, 68 * 1048576)).toBe(true);
  expect(treeSamplingLimited(80 * 1024, 68 * 1048576)).toBe(false);
});
test("scenario controls include a data-only installed package and reject unknown cases", () => {
  expect(() => sourceMemoryFiles("unknown", 6, 2)).toThrow();
  const generated = sourceMemoryFiles("config-installed", 6, 2);
  expect(generated.files["node_modules/@memory/config/must-not-run.js"]).toContain("throw Error");
  expect(JSON.parse(generated.files["tsconfig.json"]!).references).toHaveLength(2);
});
test("all ten generated scenarios exercise their expected facts against the real analyzer", async () => {
  const root = await dirs.create("apl-memory-scenarios-");
  const scenarios = await createMemoryScenarios(root, 6, 2);
  expect(scenarios).toHaveLength(memoryScenarioNames.length);
  const variant: MemoryVariant = {
    label: "before",
    backend: "native",
    commit: "same",
    directory: root,
  };
  for (const scenario of scenarios) {
    const warnings: ConstructorParameters<typeof RepositoryScanContext>[1] = [];
    const facts = await collectSourceAudit(new RepositoryScanContext(scenario.directory, warnings));
    const summary = {
      imports: facts.imports.length,
      snapshots: facts.snapshots.length,
      barrels: facts.barrels.length,
      warnings,
    };
    expect(validateMemoryOutput(summary, scenario, variant, "source")).toBe("validated");
    expect(scenario.sourceFiles).toBeGreaterThan(0);
    expect(scenario.sourceBytes).toBeGreaterThan(0);
    expect(() =>
      validateMemoryOutput({ ...summary, imports: 0 }, scenario, variant, "source"),
    ).toThrow();
    const findings = [
      ...Array.from({ length: scenario.expected!.barrels }, () => ({
        ruleId: "detected-large-barrel-file",
      })),
      ...Array.from({ length: scenario.expected!.snapshots }, () => ({
        ruleId: "large-jest-snapshot",
      })),
      ...Array.from({ length: (scenario.components ?? 0) * 2 }, () => ({
        ruleId: "prefer-direct-date-fns-imports",
      })),
    ];
    expect(validateMemoryOutput(findings, scenario, variant, "cli")).toBe("validated");
  }
});
