import { describe, expect, test } from "bun:test";
import {
  buildStepNode,
  buildJobNode,
  buildWorkflowNode,
  liftStepToJob,
  liftJobToWorkflow,
  combineNodes,
  anyNode,
  everyNode,
  formatWitnessChain,
  formatWitnesses,
  type EvidenceNode,
} from "../src/rules/shared/evidence-propagation.ts";

describe("EvidenceNode construction", () => {
  test("buildStepNode creates step-level evidence with self-witness", () => {
    const node = buildStepNode(true, "artifact-download", "strong", {
      signals: ["downloads remote tarball"],
      source: { location: { path: ".github/workflows/ci.yml", line: 42, column: 1 } },
    });

    expect(node.scope).toBe("step");
    expect(node.value).toBe(true);
    expect(node.strength).toBe("strong");
    expect(node.label).toBe("artifact-download");
    expect(node.signals).toEqual(["downloads remote tarball"]);
    expect(node.witnesses).toHaveLength(1);
    expect(node.witnesses[0]!.scope).toBe("step");
    expect(node.witnesses[0]!.label).toBe("artifact-download");
    expect(node.children).toHaveLength(0);
  });

  test("buildJobNode creates job-level evidence", () => {
    const node = buildJobNode(true, "missing-timeout", "medium", {
      signals: ["no timeout configured"],
      source: { location: { path: ".github/workflows/deploy.yml", line: 10, column: 1 } },
    });

    expect(node.scope).toBe("job");
    expect(node.strength).toBe("medium");
    expect(node.witnesses[0]!.scope).toBe("job");
  });

  test("buildWorkflowNode creates workflow-level evidence", () => {
    const node = buildWorkflowNode(true, "release-workflow", "weak", {
      signals: ["named release"],
      source: { workflowPath: ".github/workflows/release.yml" },
    });

    expect(node.scope).toBe("workflow");
    expect(node.strength).toBe("weak");
    expect(node.witnesses[0]!.source?.workflowPath).toBe(".github/workflows/release.yml");
  });
});

describe("Evidence lifting", () => {
  test("liftStepToJob propagates step evidence to job scope preserving witnesses", () => {
    const stepNode = buildStepNode(true, "runs-deploy", "strong", {
      signals: ["deploys to production"],
      source: {
        location: { path: "workflows/deploy.yml", line: 30, column: 1 },
        jobId: "deploy-job",
        workflowPath: "workflows/deploy.yml",
      },
    });

    const jobNode = liftStepToJob(stepNode, "deploy-job", undefined, "workflows/deploy.yml");

    expect(jobNode.scope).toBe("job");
    expect(jobNode.value).toBe(true);
    expect(jobNode.strength).toBe("strong");
    expect(jobNode.witnesses).toHaveLength(2);
    expect(jobNode.witnesses[0]!.scope).toBe("step");
    expect(jobNode.witnesses[1]!.scope).toBe("step");
    expect(jobNode.children).toHaveLength(1);
    expect(jobNode.children[0]).toBe(stepNode);
  });

  test("liftJobToWorkflow propagates job evidence to workflow scope", () => {
    const jobNode = buildJobNode(true, "no-concurrency", "medium", {
      signals: ["missing concurrency group"],
      source: { location: { path: "workflows/ci.yml", line: 15, column: 1 } },
    });

    const wfNode = liftJobToWorkflow(jobNode, "workflows/ci.yml");

    expect(wfNode.scope).toBe("workflow");
    expect(wfNode.strength).toBe("medium");
    expect(wfNode.witnesses).toHaveLength(2);
    expect(wfNode.witnesses[0]!.scope).toBe("job");
    expect(wfNode.children).toHaveLength(1);
  });

  test("lifting same-scope node returns it unchanged", () => {
    const node = buildJobNode(true, "already-job", "weak");
    const lifted = liftStepToJob(node as unknown as EvidenceNode<boolean>, "some-job");
    expect(lifted).toBe(node);
  });

  test("multi-hop lift preserves full chain", () => {
    const step = buildStepNode(true, "download-artifact", "strong", {
      signals: ["downloads remote artifact"],
      source: {
        location: { path: "wf.yml", line: 20, column: 1 },
        jobId: "build-job",
        workflowPath: "wf.yml",
      },
    });

    const job = liftStepToJob(step, "build-job", undefined, "wf.yml");
    const wf = liftJobToWorkflow(job, "wf.yml");

    expect(wf.scope).toBe("workflow");
    expect(wf.witnesses).toHaveLength(3);
    expect(wf.witnesses[0]!.scope).toBe("step");
    expect(wf.witnesses[1]!.scope).toBe("step");
    expect(wf.witnesses[2]!.scope).toBe("job");
    expect(wf.children).toHaveLength(2);
    expect(wf.children[0]).toBe(job);
    expect(wf.children[1]).toBe(step);
  });
});

describe("Evidence combination", () => {
  test("combineNodes merges multiple nodes at max strength", () => {
    const a = buildStepNode(true, "step-a", "strong", { signals: ["signal-a"] });
    const b = buildStepNode(true, "step-b", "weak", { signals: ["signal-b"] });

    const combined = combineNodes([a, b], "combined", (...vals) => vals.every(Boolean));

    expect(combined.strength).toBe("strong");
    expect(combined.signals).toEqual(["signal-a", "signal-b"]);
    expect(combined.witnesses).toHaveLength(2);
    expect(combined.children).toHaveLength(2);
    expect(combined.children[0]).toBe(a);
    expect(combined.children[1]).toBe(b);
  });

  test("anyNode uses OR semantics", () => {
    const a = buildStepNode(false, "step-false", "strong");
    const b = buildStepNode(true, "step-true", "medium");

    const result = anyNode([a, b], "any-true");

    expect(result.value).toBe(true);
    expect(result.strength).toBe("medium");
    expect(result.scope).toBe("step");
  });

  test("everyNode uses AND semantics", () => {
    const a = buildStepNode(true, "step-a", "strong");
    const b = buildStepNode(true, "step-b", "medium");

    const result = everyNode([a, b], "all-true");

    expect(result.value).toBe(true);
    expect(result.strength).toBe("strong");
  });

  test("everyNode returns false when any input is false", () => {
    const a = buildStepNode(true, "step-a", "strong");
    const b = buildStepNode(false, "step-b", "weak");

    const result = everyNode([a, b], "all-false");

    expect(result.value).toBe(false);
  });

  test("empty nodes list produces weak undefined node", () => {
    const result = combineNodes<boolean>([], "empty", () => false);

    expect(result.strength).toBe("weak");
    expect(result.scope).toBe("workflow");
  });
});

describe("Evidence formatting", () => {
  test("formatWitnessChain shows scope propagation", () => {
    const step = buildStepNode(true, "deploy", "strong", {
      signals: ["runs deploy"],
      source: {
        location: { path: "wf.yml", line: 30, column: 1 },
        jobId: "deploy-job",
        workflowPath: "wf.yml",
      },
    });
    const job = liftStepToJob(step, "deploy-job", undefined, "wf.yml");
    const wf = liftJobToWorkflow(job, "wf.yml", "elevated-risk");

    const chain = formatWitnessChain(wf);

    expect(chain).toContain("[step]");
    expect(chain).toContain("deploy");
    expect(chain).toContain("wf.yml:30");
    expect(chain).toContain("→");
  });

  test("formatWitnesses deduplicates by scope+label", () => {
    const a = buildStepNode(true, "same-label", "strong");
    const b = buildStepNode(true, "same-label", "medium");

    const combined = combineNodes([a, b], "combined", (...vals) => vals.some(Boolean));
    const witnesses = formatWitnesses(combined);

    expect(witnesses).toHaveLength(1);
  });
});

describe("Multi-scope evidence (operational risk example)", () => {
  test("distributed evidence across step/job/workflow composes into elevated risk", () => {
    const downloadStep = buildStepNode(true, "download-remote-artifacts", "strong", {
      signals: ["pulls unsigned binaries from S3"],
      source: {
        location: { path: "wf.yml", line: 20, column: 1 },
        jobId: "deploy-job",
        workflowPath: "wf.yml",
      },
    });

    const deployStep = buildStepNode(true, "deploys-to-production", "strong", {
      signals: ["runs prod deployment"],
      source: {
        location: { path: "wf.yml", line: 35, column: 1 },
        jobId: "deploy-job",
        workflowPath: "wf.yml",
      },
    });

    const missingTimeout = buildJobNode(true, "no-timeout-configured", "medium", {
      signals: ["job lacks timeout-minutes"],
      source: { location: { path: "wf.yml", line: 10, column: 1 }, workflowPath: "wf.yml" },
    });

    const missingConcurrency = buildJobNode(true, "no-concurrency-group", "medium", {
      signals: ["job lacks concurrency group"],
      source: { location: { path: "wf.yml", line: 11, column: 1 }, workflowPath: "wf.yml" },
    });

    const releaseWorkflow = buildWorkflowNode(true, "release-oriented-workflow", "weak", {
      signals: ["workflow name matches release pattern"],
      source: { location: { path: "wf.yml", line: 1, column: 1 } },
    });

    const deployStepsInJob = combineNodes([downloadStep, deployStep], "deploy-steps", (...vals) =>
      vals.every(Boolean),
    );
    const deployJobEvidence = combineNodes(
      [
        liftStepToJob(deployStepsInJob, "deploy-job", undefined, "wf.yml"),
        missingTimeout,
        missingConcurrency,
      ],
      "deploy-job-risk",
      (...vals) => vals.every(Boolean),
    );

    const riskEvidence = combineNodes(
      [liftJobToWorkflow(deployJobEvidence, "wf.yml", "deploy-job-risk"), releaseWorkflow],
      "elevated-operational-risk",
      (...vals) => vals.every(Boolean),
    );

    expect(riskEvidence.value).toBe(true);
    expect(riskEvidence.strength).toBe("strong");
    expect(riskEvidence.label).toBe("elevated-operational-risk");
    expect(riskEvidence.scope).toBe("workflow");

    const chain = formatWitnessChain(riskEvidence);
    expect(chain).toContain("download-remote-artifacts");
    expect(chain).toContain("deploys-to-production");
    expect(chain).toContain("no-timeout-configured");
    expect(chain).toContain("no-concurrency-group");
    expect(chain).toContain("release-oriented-workflow");

    const flat = formatWitnesses(riskEvidence);
    expect(flat.length).toBeGreaterThanOrEqual(4);
  });
});
