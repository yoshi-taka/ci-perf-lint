import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  getLocation,
  parseWorkflow,
  getNode,
  getScalarValue,
  getScalarString,
  getStringOrArrayValue,
  getMapValue,
} from "../src/workflow.ts";

function wf(
  source: string,
  repoRoot = path.join(path.sep, "repo"),
  workflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml"),
) {
  return parseWorkflow(workflowPath, repoRoot, source);
}

describe("parseWorkflow", () => {
  test("parses reusable jobs, regular steps, maps, and source nodes", () => {
    const workflow = wf(
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
    const workflow = wf(
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
    expect(() => wf("- not\n- a\n- mapping")).toThrow("Expected workflow mapping");
  });

  test("rejects YAML with parse errors", () => {
    expect(() => wf("name: unclosed string\non: [push\njobs: {}")).toThrow(
      "Failed to parse workflow",
    );
  });

  test("rejects YAML document errors (duplicate keys)", () => {
    const src = ["name: CI", "name: oops", "on: push", "jobs: {}"].join("\n");
    expect(() => wf(src)).toThrow("Failed to parse workflow");
  });
});

describe("relativePath", () => {
  test("falls back to basename when repoRoot equals fullPath dir", () => {
    const repoRoot = path.join(path.sep, "repo");
    const fullPath = path.join(repoRoot, "ci.yml");
    const doc = parseWorkflow(fullPath, repoRoot, "name: test\non: push\njobs: {}\n");
    expect(doc.relativePath).toBe("ci.yml");
  });
});

describe("getNode / getScalarValue", () => {
  test("returns scalar values of various types", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        '    runs-on: "ubuntu-latest"',
        "    timeout-minutes: 30",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    const jobNode = getNode(workflow.root!, "jobs")!;
    const buildNode = getNode(jobNode as never, "build")!;

    expect(getScalarValue(buildNode as never, "runs-on")).toBe("ubuntu-latest");
    expect(getScalarValue(buildNode as never, "timeout-minutes")).toBe(30);
    expect(getScalarValue(buildNode as never, "nonexistent")).toBeUndefined();
  });

  test("getScalarValue returns boolean for YAML booleans", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    const jobNode = getNode(workflow.root!, "jobs")!;
    const buildNode = getNode(jobNode as never, "build")!;

    expect(getScalarValue(buildNode as never, "runs-on")).toBe("ubuntu-latest");
  });

  test("getScalarString undefined returns undefined", () => {
    expect(getScalarString(undefined)).toBeUndefined();
  });
});

describe("getScalarString with sequences", () => {
  test("returns array for list-form triggers", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: [push, pull_request]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps: []",
      ].join("\n"),
    );
    expect(workflow.jobs).toHaveLength(1);
  });
});

describe("getMapValue", () => {
  test("returns undefined for non-object values", () => {
    const workflow = wf(
      ["name: CI", "on: push", "jobs:", "  build:", "    steps:", "      - run: echo"].join("\n"),
    );
    expect(workflow.jobs[0]?.steps[0]?.with).toBeUndefined();
  });
});

describe("parseWorkflow internals via public API", () => {
  test("handles workflow without name", () => {
    const workflow = wf(
      "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
    );
    expect(workflow.name).toBeUndefined();
    expect(workflow.jobs).toHaveLength(1);
  });

  test("handles workflow without on", () => {
    const workflow = wf(
      "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
    );
    expect(workflow.on).toBeUndefined();
    expect(workflow.jobs).toHaveLength(1);
  });

  test("handles workflow with empty jobs", () => {
    const workflow = wf("name: CI\non: push\njobs: {}\n");
    expect(workflow.jobs).toHaveLength(0);
  });

  test("handles jobs with missing id", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        '  "":',
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(workflow.jobs).toHaveLength(0);
  });

  test("handles job with non-map value", () => {
    const workflow = wf(["name: CI", "on: push", "jobs:", "  build: just_a_string"].join("\n"));
    expect(workflow.jobs).toHaveLength(0);
  });

  test("handles step with non-map entry", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - just a scalar step",
      ].join("\n"),
    );
    expect(workflow.jobs[0]?.steps).toHaveLength(0);
  });

  test("stores source on document", () => {
    const src =
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n";
    const workflow = wf(src);
    expect(workflow.source).toBe(src);
  });
});

describe("parsed property", () => {
  test("lazyNodeRecord returns consistent values across multiple accesses", () => {
    const workflow = wf(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    );
    const first = workflow.parsed;
    const second = workflow.parsed;
    expect(second).toEqual(first);
  });

  test("on property mirrors parsed.on", () => {
    const workflow = wf(
      [
        "name: CI",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    const parsedOn = workflow.parsed?.on;
    expect(workflow.on).toEqual(parsedOn);
  });
});

describe("job raw property", () => {
  test("lazyOptionalNodeRecord on step with returns cached value", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "        with:",
        "          fetch-depth: 0",
      ].join("\n"),
    );
    const job = workflow.jobs[0]!;
    const raw1 = job.raw;
    const raw2 = job.raw;
    expect(raw2).toEqual(raw1);
    expect(raw1["runs-on"]).toBe("ubuntu-latest");
  });
});

describe("getLocation edge cases", () => {
  test("returns fallback position for range-less node", () => {
    const workflow = wf(
      "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n",
    );
    const pos = getLocation(workflow, undefined);
    expect(pos).toEqual({ path: ".github/workflows/ci.yml", line: 1, column: 1 });
  });
});

describe("parseSteps with various step shapes", () => {
  test("parses named uses step", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Checkout",
        "        uses: actions/checkout@v4",
      ].join("\n"),
    );
    const step = workflow.jobs[0]!.steps[0]!;
    expect(step.uses).toBe("actions/checkout@v4");
    expect(step.name).toBe("Checkout");
  });

  test("parses unnamed run step", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: npm ci",
      ].join("\n"),
    );
    const step = workflow.jobs[0]!.steps[0]!;
    expect(step.run).toBe("npm ci");
  });

  test("parses step with if condition", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Test",
        "        if: success()",
        "        run: npm test",
      ].join("\n"),
    );
    const step = workflow.jobs[0]!.steps[0]!;
    expect(step.if).toBe("success()");
    expect(step.run).toBe("npm test");
    expect(step.name).toBe("Test");
  });

  test("parses step with working-directory", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: make",
        "        working-directory: ./src",
      ].join("\n"),
    );
    const step = workflow.jobs[0]!.steps[0]!;
    expect(step.workingDirectory).toBe("./src");
    expect(step.run).toBe("make");
  });
});

describe("getPair cache threshold crossing", () => {
  test("map with 6+ items uses indexed lookup (above CACHE_THRESHOLD=5)", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 60",
        "    if: ${{ success() }}",
        "    env:",
        "      NODE_ENV: test",
        "    strategy:",
        "      matrix:",
        "        node: [18, 20]",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    expect(workflow.jobs).toHaveLength(1);
    expect(workflow.jobs[0]?.id).toBe("build");
  });

  test("map with 4 items uses linear scan (below CACHE_THRESHOLD)", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo ok",
      ].join("\n"),
    );
    expect(workflow.jobs[0]?.id).toBe("build");
  });
});

describe("getScalarValue: remaining equivalence classes", () => {
  test("returns boolean for YAML boolean value", () => {
    const workflow = wf(
      [
        "debug: true",
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getScalarValue(workflow.root!, "debug")).toBe(true);
  });

  test("returns undefined for non-scalar pair value", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getScalarValue(workflow.root!, "jobs")).toBeUndefined();
  });

  test("returns undefined for missing key in map", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getScalarValue(workflow.root!, "nonexistent")).toBeUndefined();
  });
});

describe("getScalarString: remaining equivalence classes", () => {
  test("returns string from Scalar node (isScalar path)", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getScalarString(workflow.nameNode)).toBe("CI");
  });

  test("returns undefined for non-string Scalar value", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    timeout-minutes: 30",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    const jobNode = getNode(workflow.root!, "jobs")!;
    const buildNode = getNode(jobNode as never, "build")!;
    const timeoutNode = getNode(buildNode as never, "timeout-minutes");
    expect(getScalarString(timeoutNode)).toBeUndefined();
  });
});

describe("getStringOrArrayValue: equivalence classes", () => {
  test("returns array for list-form trigger", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: [push, pull_request]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getStringOrArrayValue(workflow.root!, "on")).toEqual(["push", "pull_request"]);
  });

  test("returns string for scalar trigger", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getStringOrArrayValue(workflow.root!, "on")).toBe("push");
  });

  test("returns undefined for missing key", () => {
    const workflow = wf(
      [
        "name: CI",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getStringOrArrayValue(workflow.root!, "on")).toBeUndefined();
  });
});

describe("getMapValue: equivalence classes", () => {
  test("returns undefined when value is not an object", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    expect(getMapValue(workflow.root!, "name")).toBeUndefined();
  });
});

describe("getLocation: missing equivalence classes", () => {
  test("returns fallback for range-less node", () => {
    const workflow = wf(
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo",
      ].join("\n"),
    );
    const pos = getLocation(workflow, workflow.jobsNode?.items[0] as never);
    expect(pos.line).toBeGreaterThanOrEqual(1);
  });
});
