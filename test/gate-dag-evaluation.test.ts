import { describe, expect, test } from "bun:test";
import { buildDag } from "../src/repository-diagnostics/gates.ts";
import type { GateKey } from "../src/repository-diagnostics/collector-types.ts";

const gatePrerequisites: Partial<Record<GateKey, GateKey[]>> = {
  hasJavaScriptLinting: ["hasJavaScriptTooling"],
  hasJavaScriptBuildConfig: ["hasJavaScriptTooling"],
  hasJavaScriptPackageScripts: ["hasJavaScriptTooling"],
  hasJavaScriptFrameworks: ["hasJavaScriptTooling"],
};

describe("gate DAG", () => {
  test("buildDag constructs correct successors/ predecessors", () => {
    const dag = buildDag(gatePrerequisites);

    const toolingSuccs = dag.successors.get("hasJavaScriptTooling" as GateKey);
    expect(toolingSuccs).toBeDefined();
    expect(toolingSuccs).toContain("hasJavaScriptLinting");
    expect(toolingSuccs).toContain("hasJavaScriptBuildConfig");
    expect(toolingSuccs).toContain("hasJavaScriptPackageScripts");
    expect(toolingSuccs).toContain("hasJavaScriptFrameworks");

    const lintingPreds = dag.predecessors.get("hasJavaScriptLinting" as GateKey);
    expect(lintingPreds).toBeDefined();
    expect(lintingPreds).toContain("hasJavaScriptTooling");
  });

  test("topological sort respects dependency order", () => {
    const dag = buildDag(gatePrerequisites);
    const order = dag.evaluationOrder;

    const toolingIdx = order.indexOf("hasJavaScriptTooling" as GateKey);
    const lintingIdx = order.indexOf("hasJavaScriptLinting" as GateKey);
    const buildConfigIdx = order.indexOf("hasJavaScriptBuildConfig" as GateKey);
    const packageScriptsIdx = order.indexOf("hasJavaScriptPackageScripts" as GateKey);
    const frameworksIdx = order.indexOf("hasJavaScriptFrameworks" as GateKey);

    expect(toolingIdx).toBeLessThan(lintingIdx);
    expect(toolingIdx).toBeLessThan(buildConfigIdx);
    expect(toolingIdx).toBeLessThan(packageScriptsIdx);
    expect(toolingIdx).toBeLessThan(frameworksIdx);
  });

  test("roots have no predecessors", () => {
    const dag = buildDag(gatePrerequisites);
    for (const root of dag.roots) {
      const preds = dag.predecessors.get(root);
      expect(preds).toHaveLength(0);
    }
  });

  test("prerequisites are included as nodes even without their own prerequisites", () => {
    const dag = buildDag(gatePrerequisites);
    expect(dag.successors.has("hasJavaScriptTooling" as GateKey)).toBe(true);
    expect(dag.successors.has("hasJavaScriptLinting" as GateKey)).toBe(true);
  });
});

describe("gate dependency pruning behavior via analyzeRepository", () => {
  test("wrangler-toml findings fire when packageScripts gate is true", async () => {
    const { analyzeRepository } = await import("../src/repo.ts");
    const { fixtures } = await import("./fixtures.ts");

    const report = await analyzeRepository({
      cwd: fixtures.wranglerTomlLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const wranglerFindings = report.findings.filter(
      (f) => f.ruleId === "prefer-node-run-over-npm-run" && f.location.path === "wrangler.toml",
    );
    expect(wranglerFindings.length).toBeGreaterThan(0);
    expect(wranglerFindings[0]?.scope).toBe("repository");
  });

  test("amplify-yml findings fire when packageScripts gate is true", async () => {
    const { analyzeRepository } = await import("../src/repo.ts");
    const { fixtures } = await import("./fixtures.ts");

    const report = await analyzeRepository({
      cwd: fixtures.amplifyYmlLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const amplifyFindings = report.findings.filter(
      (f) => f.ruleId === "prefer-node-run-over-npm-run" && f.location.path === "amplify.yml",
    );
    expect(amplifyFindings.length).toBeGreaterThan(0);
    expect(amplifyFindings[0]?.scope).toBe("repository");
  });

  test("js tooling false skips packageScripts gate", async () => {
    const { analyzeRepository } = await import("../src/repo.ts");
    const { fixtures } = await import("./fixtures.ts");

    const report = await analyzeRepository({
      cwd: fixtures.duplicationLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const jsToolingFindings = report.findings.filter(
      (f) => f.ruleId === "redundant-npx-or-bootstrap",
    );
    expect(jsToolingFindings.length).toBeGreaterThan(0);
  });
});
