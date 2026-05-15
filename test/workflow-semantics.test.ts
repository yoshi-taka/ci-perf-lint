import { describe, expect, test } from "bun:test";
import { buildWorkflowSemantics } from "../src/rules/shared/workflow-semantics.ts";
import type { WorkflowDocument } from "../src/workflow.ts";

function makeWorkflow(
  overrides: Partial<WorkflowDocument> & { on?: unknown } = {},
): WorkflowDocument {
  return {
    kind: "github-actions",
    path: ".github/workflows/test.yml",
    relativePath: ".github/workflows/test.yml",
    source: "name: test\non: push\njobs: {}",
    jobs: overrides.jobs ?? [],
    on: overrides.on,
    ...overrides,
  } as WorkflowDocument;
}

describe("buildWorkflowSemantics", () => {
  test("detects push trigger", () => {
    const wf = makeWorkflow({ on: { push: ["main"] } });
    const s = buildWorkflowSemantics(wf);
    expect(s.trigger.hasPush).toBe(true);
    expect(s.trigger.hasPullRequest).toBe(false);
    expect(s.trigger.hasSchedule).toBe(false);
  });

  test("detects pull_request trigger", () => {
    const wf = makeWorkflow({ on: { pull_request: ["main"] } });
    const s = buildWorkflowSemantics(wf);
    expect(s.trigger.hasPullRequest).toBe(true);
    expect(s.trigger.hasPush).toBe(false);
  });

  test("detects schedule trigger", () => {
    const wf = makeWorkflow({ on: { schedule: [{ cron: "0 0 * * *" }] } });
    const s = buildWorkflowSemantics(wf);
    expect(s.trigger.hasSchedule).toBe(true);
  });

  test("detects manual-only trigger", () => {
    const wf = makeWorkflow({ on: { workflow_dispatch: {} } });
    const s = buildWorkflowSemantics(wf);
    expect(s.trigger.hasManualOnly).toBe(true);
    expect(s.trigger.hasPush).toBe(false);
  });

  test("counts jobs and steps", () => {
    const wf = makeWorkflow({
      on: { push: null },
      jobs: [
        { id: "job1", steps: [{ name: "s1" }, { name: "s2" }], raw: {} },
        { id: "job2", steps: [{ name: "s3" }], raw: {} },
      ],
    } as unknown as Partial<WorkflowDocument>);
    const s = buildWorkflowSemantics(wf);
    expect(s.jobCount).toBe(2);
    expect(s.stepCount).toBe(3);
    expect(s.jobs.length).toBe(2);
  });

  test("marks heavy workflow", () => {
    const wf = makeWorkflow({
      on: { push: null },
      jobs: Array.from({ length: 5 }, (_, i) => ({
        id: `build-${i}`,
        steps: [{ name: "s1", run: "echo hi" }],
        raw: {},
      })),
    } as unknown as Partial<WorkflowDocument>);
    const s = buildWorkflowSemantics(wf);
    expect(s.isHeavy).toBe(true);
  });

  test("detects concurrency", () => {
    const wf = makeWorkflow({ on: { push: null } });
    const s = buildWorkflowSemantics(wf);
    expect(s.hasConcurrency).toBe(false);
  });
});
