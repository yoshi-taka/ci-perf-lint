import { describe, expect, test } from "bun:test";
import { collectorRequiresAllGates } from "../src/repository-diagnostics/collector-types.ts";
import type { RepositoryDiagnosticGateState } from "../src/repository-diagnostics/collector-types.ts";

function makeState(
  overrides?: Partial<RepositoryDiagnosticGateState>,
): RepositoryDiagnosticGateState {
  return {
    hasJavaScriptHeavyWorkflow: false,
    hasJavaScriptTooling: false,
    hasJavaScriptLinting: false,
    hasJavaScriptBuildConfig: false,
    hasJavaScriptPackageScripts: false,
    hasDockerHeavyWorkflow: false,
    hasTerraformHeavyWorkflow: false,
    hasLargeFiles: false,
    hasDatadogHeavyWorkflow: false,
    hasPytest: false,
    hasPythonHeavyWorkflow: false,
    hasRenovateConfig: false,
    hasHusky: false,
    hasJavaScriptFrameworks: false,
    hasRust: false,
    hasCdkManifest: false,
    hasElixirHeavyWorkflow: false,
    hasGradle: false,
    ...overrides,
  };
}

describe("collectorRequiresAllGates", () => {
  test("single gate true returns true", () => {
    const state = makeState({ hasJavaScriptTooling: true });
    expect(collectorRequiresAllGates({ gate: "hasJavaScriptTooling" }, state)).toBe(true);
  });

  test("single gate false returns false", () => {
    const state = makeState({ hasJavaScriptTooling: false });
    expect(collectorRequiresAllGates({ gate: "hasJavaScriptTooling" }, state)).toBe(false);
  });

  test("multiple gates all true returns true", () => {
    const state = makeState({ hasJavaScriptTooling: true, hasJavaScriptLinting: true });
    expect(
      collectorRequiresAllGates(
        { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
        state,
      ),
    ).toBe(true);
  });

  test("multiple gates one false returns false", () => {
    const state = makeState({ hasJavaScriptTooling: true, hasJavaScriptLinting: false });
    expect(
      collectorRequiresAllGates(
        { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
        state,
      ),
    ).toBe(false);
  });

  test("multiple gates all false returns false", () => {
    const state = makeState({ hasJavaScriptTooling: false, hasJavaScriptLinting: false });
    expect(
      collectorRequiresAllGates(
        { gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const },
        state,
      ),
    ).toBe(false);
  });

  test("no gate and no gates returns true", () => {
    const state = makeState();
    expect(collectorRequiresAllGates({}, state)).toBe(true);
  });

  test("gates takes precedence over gate when both present", () => {
    const state = makeState({ hasJavaScriptTooling: true, hasJavaScriptLinting: false });
    expect(
      collectorRequiresAllGates(
        {
          gate: "hasJavaScriptTooling",
          gates: ["hasJavaScriptTooling", "hasJavaScriptLinting"] as const,
        },
        state,
      ),
    ).toBe(false);
  });
});
