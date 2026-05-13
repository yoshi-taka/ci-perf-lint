import { describe, expect, test } from "bun:test";
import { extractSemanticSteps, groupStepsByJob } from "../src/rules/shared/semantic-adapter.ts";
import type { WorkflowDocument, WorkflowStep, WorkflowJob } from "../src/workflow.ts";
import type { YAMLMap } from "yaml";

function makeStep(run: string): WorkflowStep {
  return { run, node: { items: [] } as unknown as YAMLMap<unknown, unknown> };
}

function makeJob(id: string, steps: WorkflowStep[]): WorkflowJob {
  const mockNode = { items: [] } as unknown as YAMLMap<unknown, unknown>;
  return { id, steps, node: mockNode, raw: {}, hasIf: false, usesReusableWorkflow: false };
}

const mockGitHubActionsDoc: WorkflowDocument = {
  path: "/.github/workflows/ci.yml",
  relativePath: ".github/workflows/ci.yml",
  jobs: [
    makeJob("build", [makeStep("npm ci"), makeStep("npm test"), makeStep("npm run lint")]),
    makeJob("deploy", [makeStep("npm run build")]),
  ],
};

describe("extractSemanticSteps", () => {
  test("extracts steps from GitHub Actions workflow", () => {
    const steps = extractSemanticSteps(mockGitHubActionsDoc);
    expect(steps).toHaveLength(4);
  });

  test("classifies npm ci as install", () => {
    const steps = extractSemanticSteps(mockGitHubActionsDoc);
    const installStep = steps.find((s) => s.text.includes("npm ci"));
    expect(installStep?.commandType).toBe("install");
  });

  test("classifies npm test as test", () => {
    const steps = extractSemanticSteps(mockGitHubActionsDoc);
    const testStep = steps.find((s) => s.text.includes("npm test"));
    expect(testStep?.commandType).toBe("test");
  });

  test("classifies npm run build as build", () => {
    const steps = extractSemanticSteps(mockGitHubActionsDoc);
    const buildStep = steps.find((s) => s.text.includes("npm run build"));
    expect(buildStep?.commandType).toBe("build");
  });
});

describe("groupStepsByJob", () => {
  test("groups steps by job name", () => {
    const steps = extractSemanticSteps(mockGitHubActionsDoc);
    const groups = groupStepsByJob(steps);

    expect(groups.get("build")).toHaveLength(3);
    expect(groups.get("deploy")).toHaveLength(1);
  });

  test("returns empty map for empty steps", () => {
    const groups = groupStepsByJob([]);
    expect(groups.size).toBe(0);
  });
});
