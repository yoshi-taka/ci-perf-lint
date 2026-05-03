import { describe, expect, test } from "bun:test";
import path from "node:path";
import { getLocation, parseWorkflow } from "../src/workflow.ts";

describe("parseWorkflow", () => {
  test("parses reusable jobs, regular steps, maps, and source nodes", () => {
    const repoRoot = path.join(path.sep, "repo");
    const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
    const workflow = parseWorkflow(
      workflowPath,
      repoRoot,
      [
        "name: CI",
        "on: push",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "jobs:",
        "  call-reusable:",
        "    if: ${{ github.event_name == 'pull_request' }}",
        "    uses: org/repo/.github/workflows/reusable.yml@main",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    concurrency: build-${{ github.ref }}",
        "    steps:",
        "      - name: Checkout",
        "        uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
        "      - run: bun test",
        "        timeout-minutes: 5",
        "      - echo this scalar step is ignored",
      ].join("\n"),
    );

    expect(workflow.relativePath).toBe(".github/workflows/ci.yml");
    expect(workflow.name).toBe("CI");
    expect(workflow.concurrencyNode).toBeDefined();
    expect(workflow.jobs).toHaveLength(2);

    const reusableJob = workflow.jobs[0];
    expect(reusableJob?.id).toBe("call-reusable");
    expect(reusableJob?.hasIf).toBe(true);
    expect(reusableJob?.usesReusableWorkflow).toBe(true);
    expect(reusableJob?.steps).toHaveLength(0);

    const buildJob = workflow.jobs[1];
    expect(buildJob?.id).toBe("build");
    expect(buildJob?.concurrencyNode).toBeDefined();
    expect(buildJob?.usesReusableWorkflow).toBe(false);
    expect(buildJob?.steps).toHaveLength(2);
    expect(buildJob?.steps[0]?.uses).toBe("actions/checkout@v4");
    expect(buildJob?.steps[0]?.with).toEqual({ "fetch-depth": 0 });
    expect(buildJob?.steps[1]?.run).toBe("bun test");
    expect(buildJob?.steps[1]?.timeoutNode).toBeDefined();
  });

  test("keeps line and column locations tied to YAML source nodes", () => {
    const repoRoot = path.join(path.sep, "repo");
    const workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
    const workflow = parseWorkflow(
      workflowPath,
      repoRoot,
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Test",
        "        run: bun test",
      ].join("\n"),
    );

    expect(getLocation(workflow, workflow.jobs[0]?.idNode)).toEqual({
      path: ".github/workflows/ci.yml",
      line: 4,
      column: 3,
    });
    expect(getLocation(workflow, workflow.jobs[0]?.steps[0]?.runNode)).toEqual({
      path: ".github/workflows/ci.yml",
      line: 8,
      column: 14,
    });
    expect(getLocation(workflow, undefined)).toEqual({
      path: ".github/workflows/ci.yml",
      line: 1,
      column: 1,
    });
  });

  test("rejects non-mapping workflow documents", () => {
    expect(() =>
      parseWorkflow(
        path.join(path.sep, "repo", ".github", "workflows", "ci.yml"),
        path.join(path.sep, "repo"),
        "- not\n- a\n- mapping",
      ),
    ).toThrow("Expected workflow mapping");
  });
});
