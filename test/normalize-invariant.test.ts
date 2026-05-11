import { describe, expect, test } from "bun:test";
import { collectCommandEntries } from "../src/rules/shared/any-step.ts";
import type { WorkflowDocument } from "../src/workflow.ts";
import type { PipelineDocument } from "../src/buildkite-workflow.ts";
import type { CircleCiDocument } from "../src/circleci-workflow.ts";
import type { GitlabCiDocument } from "../src/gitlab-ci-workflow.ts";

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

function makeCircleCiWorkflow(steps: { command: string; name?: string }[]): CircleCiDocument {
  return {
    kind: "circleci",
    path: ".circleci/config.yml",
    relativePath: ".circleci/config.yml",
    jobs: [
      {
        name: "build",
        node: undefined as never,
        steps: steps.map((s, i) => ({
          type: "run",
          ...s,
          name: s.name ?? `Step ${i}`,
          node: undefined as never,
        })),
      },
    ],
    source: "",
  } as CircleCiDocument;
}

function makeGitlabCiWorkflow(commands: string[]): GitlabCiDocument {
  return {
    kind: "gitlab-ci",
    path: ".gitlab-ci.yml",
    relativePath: ".gitlab-ci.yml",
    jobs: [
      {
        name: "build",
        node: undefined as never,
        script: commands,
      },
    ],
    source: "",
  } as GitlabCiDocument;
}

describe("normalize CI documents invariants", () => {
  test("single command across all 4 providers produces same text", () => {
    const gh = makeGithubActionsWorkflow([{ run: "npm run build" }]);
    const bk = makeBuildkitePipeline([{ command: "npm run build" }]);
    const cc = makeCircleCiWorkflow([{ command: "npm run build" }]);
    const gl = makeGitlabCiWorkflow(["npm run build"]);

    const ghEntries = collectCommandEntries(gh);
    const bkEntries = collectCommandEntries(bk);
    const ccEntries = collectCommandEntries(cc);
    const glEntries = collectCommandEntries(gl);

    expect(ghEntries).toHaveLength(1);
    expect(bkEntries).toHaveLength(1);
    expect(ccEntries).toHaveLength(1);
    expect(glEntries).toHaveLength(1);
    expect(ghEntries[0]!.text).toBe(bkEntries[0]!.text);
    expect(ccEntries[0]!.text).toBe(bkEntries[0]!.text);
    expect(glEntries[0]!.text).toBe(bkEntries[0]!.text);
  });

  test("multiple commands across CI types", () => {
    const cmds = ["npm install", "npm run build", "npm test"];
    const gh = makeGithubActionsWorkflow(cmds.map((run) => ({ run })));
    const bk = makeBuildkitePipeline([{ commands: cmds }]);
    const cc = makeCircleCiWorkflow(cmds.map((command) => ({ command })));
    const gl = makeGitlabCiWorkflow(cmds);

    const ghEntries = collectCommandEntries(gh);
    const bkEntries = collectCommandEntries(bk);
    const ccEntries = collectCommandEntries(cc);
    const glEntries = collectCommandEntries(gl);

    for (const entries of [ghEntries, bkEntries, ccEntries, glEntries]) {
      expect(entries).toHaveLength(3);
    }
    for (let i = 0; i < 3; i++) {
      expect(ghEntries[i]!.text).toBe(bkEntries[i]!.text);
      expect(ccEntries[i]!.text).toBe(bkEntries[i]!.text);
      expect(glEntries[i]!.text).toBe(bkEntries[i]!.text);
    }
  });

  test("empty commands produce empty entries across all providers", () => {
    expect(collectCommandEntries(makeGithubActionsWorkflow([]))).toHaveLength(0);
    expect(collectCommandEntries(makeBuildkitePipeline([]))).toHaveLength(0);
    expect(collectCommandEntries(makeCircleCiWorkflow([]))).toHaveLength(0);
    expect(collectCommandEntries(makeGitlabCiWorkflow([]))).toHaveLength(0);
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
    const first = collectCommandEntries(gh);
    const second = collectCommandEntries(gh);
    expect(first.map((e) => e.text)).toEqual(second.map((e) => e.text));
  });
});
