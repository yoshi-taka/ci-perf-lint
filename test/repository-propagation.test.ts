import { describe, expect, test } from "bun:test";
import { parseWorkflow, type WorkflowDocument } from "../src/workflow.ts";
import { buildPropagationClusters } from "../src/repository-diagnostics/repository-propagation.ts";
import type { Diagnostic } from "../src/types.ts";

function makeDiagnostic(ruleId: string, workflow: string, score: number): Diagnostic {
  return {
    ruleId,
    severity: "warning",
    confidence: "high",
    docsPath: `docs/rules/${ruleId}.md`,
    workflow,
    location: { path: workflow, line: 1, column: 1 },
    message: "test finding",
    why: "test",
    suggestion: "fix it",
    measurementHint: "measure",
    aiHandoff: "handoff",
    score,
  };
}

const workflowBase = `name: test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`;

const workflowNode = `name: node-app
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
`;

const workflowNodeDocker = `name: node-docker-app
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: docker build .
`;

const workflowPython = `name: python-app
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt
`;

const workflowScheduled = `name: scheduled-task
on:
  schedule:
    - cron: '0 0 * * *'
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
`;

function parseWorkflowSource(source: string, relativePath: string): WorkflowDocument {
  return parseWorkflow(`/repo/${relativePath}`, "/repo", source);
}

describe("buildPropagationClusters", () => {
  test("clusters findings by ruleId across workflows", async () => {
    const wf1 = parseWorkflowSource(workflowNode, "node.yml");
    const wf2 = parseWorkflowSource(workflowNodeDocker, "node-docker.yml");
    const wf3 = parseWorkflowSource(workflowPython, "python.yml");
    const wf4 = parseWorkflowSource(workflowScheduled, "scheduled.yml");
    const wf5 = parseWorkflowSource(workflowBase, "base.yml");
    const workflows = [wf1, wf2, wf3, wf4, wf5];

    const findings: Diagnostic[] = [
      makeDiagnostic("npm-ci-over-npm-install", "node.yml", 60),
      makeDiagnostic("npm-ci-over-npm-install", "node-docker.yml", 60),
      makeDiagnostic("npm-ci-over-npm-install", "scheduled.yml", 60),
      makeDiagnostic("pip-install-diagnostic", "python.yml", 50),
    ];

    const clusters = await buildPropagationClusters(findings, workflows, "/repo");

    expect(clusters).toHaveLength(2);

    const npmCluster = clusters.find((c) => c.ruleId === "npm-ci-over-npm-install");
    expect(npmCluster).toBeDefined();
    expect(npmCluster!.memberWorkflows).toHaveLength(3);
    expect(npmCluster!.memberWorkflows).toContain("node.yml");
    expect(npmCluster!.memberWorkflows).toContain("node-docker.yml");
    expect(npmCluster!.memberWorkflows).toContain("scheduled.yml");
    expect(npmCluster!.sourceWorkflow).toBeTruthy();
    expect(npmCluster!.metrics.diffusionCoefficient).toBeGreaterThan(0);
    expect(npmCluster!.metrics.weightedDiffusionMass).toBeGreaterThan(0);

    const pipCluster = clusters.find((c) => c.ruleId === "pip-install-diagnostic");
    expect(pipCluster).toBeDefined();
    expect(pipCluster!.memberWorkflows).toHaveLength(1);
  });

  test("computes diffusion metrics correctly", async () => {
    const wf1 = parseWorkflowSource(workflowNode, "a.yml");
    const wf2 = parseWorkflowSource(workflowNodeDocker, "b.yml");
    const wf3 = parseWorkflowSource(workflowNode, "c.yml");
    const workflows = [wf1, wf2, wf3];
    const repoRoot = "/repo";

    const findings = [
      makeDiagnostic("some-rule", "a.yml", 50),
      makeDiagnostic("some-rule", "b.yml", 60),
      makeDiagnostic("some-rule", "c.yml", 40),
    ];

    const clusters = await buildPropagationClusters(findings, workflows, repoRoot);
    expect(clusters).toHaveLength(1);

    const cluster = clusters[0]!;
    expect(cluster.memberCount).toBe(3);
    expect(cluster.metrics.diffusionCoefficient).toBe(1);
    expect(cluster.metrics.weightedDiffusionMass).toBeGreaterThan(0);
    expect(cluster.metrics.propagationDepth).toBeGreaterThanOrEqual(0);
    expect(cluster.metrics.workflowCentrality).toBeGreaterThan(0);
    expect(cluster.sourceWorkflow).toBeTruthy();
  });

  test("single-workflow cluster has zero depth and low confidence", async () => {
    const wf = parseWorkflowSource(workflowNode, "standalone.yml");
    const findings = [makeDiagnostic("unique-rule", "standalone.yml", 50)];
    const clusters = await buildPropagationClusters(findings, [wf], "/repo");

    expect(clusters).toHaveLength(1);
    const cluster = clusters[0]!;
    expect(cluster.memberCount).toBe(1);
    expect(cluster.metrics.propagationDepth).toBe(0);
    expect(cluster.metrics.diffusionCoefficient).toBeLessThanOrEqual(1);
    expect(cluster.sourceConfidence).toBe("low");
    expect(cluster.sourceReason).toBe("single member cluster");
  });

  test("empty findings produces empty clusters", async () => {
    const wf = parseWorkflowSource(workflowNode, "any.yml");
    const clusters = await buildPropagationClusters([], [wf], "/repo");
    expect(clusters).toHaveLength(0);
  });

  test("sorts clusters by weightedDiffusionMass descending", async () => {
    const wf1 = parseWorkflowSource(workflowNode, "a.yml");
    const wf2 = parseWorkflowSource(workflowNodeDocker, "b.yml");
    const wf3 = parseWorkflowSource(workflowPython, "c.yml");
    const workflows = [wf1, wf2, wf3];

    const findings = [
      makeDiagnostic("high-mass-rule", "a.yml", 100),
      makeDiagnostic("high-mass-rule", "b.yml", 90),
      makeDiagnostic("low-mass-rule", "c.yml", 10),
    ];

    const clusters = await buildPropagationClusters(findings, workflows, "/repo");

    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.ruleId).toBe("high-mass-rule");
    expect(clusters[1]!.ruleId).toBe("low-mass-rule");
  });

  test("preserves diagnostic index for all finding workflows", async () => {
    const wf1 = parseWorkflowSource(workflowNode, "first.yml");
    const wf2 = parseWorkflowSource(workflowNodeDocker, "second.yml");
    const wf3 = parseWorkflowSource(workflowPython, "third.yml");
    const workflows = [wf1, wf2, wf3];

    const findings = [
      makeDiagnostic("shared-rule", "first.yml", 50),
      makeDiagnostic("shared-rule", "second.yml", 60),
      makeDiagnostic("shared-rule", "third.yml", 50),
    ];

    const clusters = await buildPropagationClusters(findings, workflows, "/repo");

    const cluster = clusters.find((c) => c.ruleId === "shared-rule");
    expect(cluster).toBeDefined();
    expect(cluster!.memberWorkflows).toEqual(
      expect.arrayContaining(["first.yml", "second.yml", "third.yml"]),
    );
  });
});
