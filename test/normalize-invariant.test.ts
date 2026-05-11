import { describe, expect, test } from "bun:test";
import { collectCommandEntries } from "../src/rules/shared/any-step.ts";
import type { WorkflowDocument } from "../src/workflow.ts";
import type { PipelineDocument } from "../src/buildkite-workflow.ts";

function makeGithubActionsWorkflow(steps: { run: string; name?: string }[]): WorkflowDocument {
  return {
    source: "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps: []",
    relativePath: ".github/workflows/ci.yml",
    name: "CI",
    on: { push: null },
    permissions: {},
    env: {},
    concurrency: undefined,
    defaults: undefined,
    jobs: [
      {
        id: "build",
        runsOn: "ubuntu-latest",
        steps: steps.map((s, i) => ({
          ...s,
          _node: undefined,
          runNode: undefined,
          runIndex: i,
          id: `step-${i}`,
        })),
        _node: undefined,
        needs: [],
        if: undefined,
        env: {},
        continueOnError: undefined,
        timeout: undefined,
        strategy: undefined,
        container: undefined,
        services: undefined,
      },
    ],
    _node: undefined,
    imports: [],
  } as unknown as WorkflowDocument;
}

function makeBuildkitePipeline(
  steps: { command?: string; commands?: string[]; label?: string }[],
): PipelineDocument {
  return {
    source: "steps:\n  - label: test\n    command: echo hello",
    relativePath: ".buildkite/pipeline.yml",
    steps: steps.map((s, i) => ({
      ...s,
      label: s.label ?? `step-${i}`,
      _node: undefined,
      commandNode: undefined,
      isWait: false,
      isBlock: false,
      isTrigger: false,
      isGroup: false,
    })),
  } as unknown as PipelineDocument;
}

describe("normalize CI documents invariants", () => {
  test("single command across GH Actions and Buildkite produces same text", () => {
    const gh = makeGithubActionsWorkflow([{ run: "npm run build" }]);
    const bk = makeBuildkitePipeline([{ command: "npm run build" }]);

    const ghEntries = collectCommandEntries(gh);
    const bkEntries = collectCommandEntries(bk);

    expect(ghEntries).toHaveLength(1);
    expect(bkEntries).toHaveLength(1);
    expect(ghEntries[0]!.text).toBe(bkEntries[0]!.text);
  });

  test("multiple commands across CI types", () => {
    const gh = makeGithubActionsWorkflow([
      { run: "npm install" },
      { run: "npm run build" },
      { run: "npm test" },
    ]);
    const bk = makeBuildkitePipeline([{ commands: ["npm install", "npm run build", "npm test"] }]);

    const ghEntries = collectCommandEntries(gh);
    const bkEntries = collectCommandEntries(bk);

    expect(ghEntries).toHaveLength(3);
    expect(bkEntries).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(ghEntries[i]!.text).toBe(bkEntries[i]!.text);
    }
  });

  test("empty commands produce empty entries", () => {
    const gh = makeGithubActionsWorkflow([]);
    const bk = makeBuildkitePipeline([]);

    expect(collectCommandEntries(gh)).toHaveLength(0);
    expect(collectCommandEntries(bk)).toHaveLength(0);
  });

  test("Buildkite wait/block/trigger steps are excluded", () => {
    const bk: PipelineDocument = {
      source: "",
      relativePath: ".buildkite/pipeline.yml",
      steps: [
        {
          label: "wait",
          command: "",
          _node: undefined,
          commandNode: undefined,
          isWait: true,
          isBlock: false,
          isTrigger: false,
          isGroup: false,
        },
        {
          label: "real-step",
          command: "npm test",
          _node: undefined,
          commandNode: undefined,
          isWait: false,
          isBlock: false,
          isTrigger: false,
          isGroup: false,
        },
        {
          label: "block",
          command: "block-command",
          _node: undefined,
          commandNode: undefined,
          isWait: false,
          isBlock: true,
          isTrigger: false,
          isGroup: false,
        },
      ],
    } as unknown as PipelineDocument;

    const entries = collectCommandEntries(bk);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("npm test");
  });

  test("deterministic output ordering across repeated calls", () => {
    const gh = makeGithubActionsWorkflow([{ run: "c" }, { run: "a" }, { run: "b" }]);
    const bk = makeBuildkitePipeline([
      { command: "c", label: "z" },
      { command: "a", label: "x" },
      { command: "b", label: "y" },
    ]);

    const ghFirst = collectCommandEntries(gh);
    const ghSecond = collectCommandEntries(gh);
    const bkFirst = collectCommandEntries(bk);
    const bkSecond = collectCommandEntries(bk);

    expect(ghFirst.map((e) => e.text)).toEqual(ghSecond.map((e) => e.text));
    expect(bkFirst.map((e) => e.text)).toEqual(bkSecond.map((e) => e.text));
  });
});
