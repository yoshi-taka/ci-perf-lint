import { describe, expect, test } from "bun:test";
import { collectorRequiresAllGatesFromResults } from "../src/repository-diagnostics/collector-types.ts";
import type { GateResultRecord } from "../src/repository-diagnostics/collector-types.ts";

function makeResults(overrides?: Partial<GateResultRecord>): GateResultRecord {
  const r: GateResultRecord = {
    hasJavaScriptHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasJavaScriptTooling: { status: "skipped", reason: "not evaluated" },
    hasJavaScriptLinting: { status: "skipped", reason: "not evaluated" },
    hasJavaScriptBuildConfig: { status: "skipped", reason: "not evaluated" },
    hasJavaScriptPackageScripts: { status: "skipped", reason: "not evaluated" },
    hasDockerHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasTerraformHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasLargeFiles: { status: "skipped", reason: "not evaluated" },
    hasDatadogHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasPytest: { status: "skipped", reason: "not evaluated" },
    hasPythonHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasRenovateConfig: { status: "skipped", reason: "not evaluated" },
    hasHusky: { status: "skipped", reason: "not evaluated" },
    hasJavaScriptFrameworks: { status: "skipped", reason: "not evaluated" },
    hasRust: { status: "skipped", reason: "not evaluated" },
    hasCdkManifest: { status: "skipped", reason: "not evaluated" },
    hasElixirHeavyWorkflow: { status: "skipped", reason: "not evaluated" },
    hasGradle: { status: "skipped", reason: "not evaluated" },
    ...overrides,
  };
  return r;
}

describe("collectorRequiresAllGatesFromResults", () => {
  test("single gate resolved true returns resolved true", () => {
    const results = makeResults({ hasGradle: { status: "resolved", value: true } });
    const r = collectorRequiresAllGatesFromResults({ gate: "hasGradle" }, results);
    expect(r).toEqual({ status: "resolved", value: true });
  });

  test("single gate resolved false returns resolved false", () => {
    const results = makeResults({ hasGradle: { status: "resolved", value: false } });
    const r = collectorRequiresAllGatesFromResults({ gate: "hasGradle" }, results);
    expect(r).toEqual({ status: "resolved", value: false });
  });

  test("single gate skipped propagates skipped", () => {
    const results = makeResults({
      hasGradle: { status: "skipped", reason: "parent gate X is false" },
    });
    const r = collectorRequiresAllGatesFromResults({ gate: "hasGradle" }, results);
    expect(r.status).toBe("skipped");
    if (r.status === "skipped") {
      expect(r.reason).toContain("parent gate");
    }
  });

  test("single gate error propagates error", () => {
    const results = makeResults({ hasGradle: { status: "error", reason: "ENOENT" } });
    const r = collectorRequiresAllGatesFromResults({ gate: "hasGradle" }, results);
    expect(r.status).toBe("error");
  });

  test("multiple gates all resolved true returns resolved true", () => {
    const results = makeResults({
      hasJavaScriptTooling: { status: "resolved", value: true },
      hasJavaScriptLinting: { status: "resolved", value: true },
    });
    const r = collectorRequiresAllGatesFromResults(
      { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
      results,
    );
    expect(r).toEqual({ status: "resolved", value: true });
  });

  test("multiple gates one resolved false short-circuits", () => {
    const results = makeResults({
      hasJavaScriptTooling: { status: "resolved", value: true },
      hasJavaScriptLinting: { status: "resolved", value: false },
    });
    const r = collectorRequiresAllGatesFromResults(
      { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
      results,
    );
    expect(r).toEqual({ status: "resolved", value: false });
  });

  test("multiple gates one skipped short-circuits", () => {
    const results = makeResults({
      hasJavaScriptTooling: { status: "resolved", value: true },
      hasJavaScriptLinting: { status: "skipped", reason: "parent gate" },
    });
    const r = collectorRequiresAllGatesFromResults(
      { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
      results,
    );
    expect(r.status).toBe("skipped");
  });

  test("no gate returns resolved true", () => {
    const results = makeResults();
    const r = collectorRequiresAllGatesFromResults({}, results);
    expect(r).toEqual({ status: "resolved", value: true });
  });

  test("not-evaluated gate returns skipped", () => {
    const results = makeResults();
    const r = collectorRequiresAllGatesFromResults({ gate: "hasGradle" }, results);
    expect(r.status).toBe("skipped");
  });
});
