import { describe, expect, test } from "bun:test";
import {
  normalizeConcurrencyGroup,
  concurrencyGroupsEqual,
  parseConcurrencyGroup,
  findWorkflowDependencies,
  findWorkflowRunDependents,
  detectConcurrencyDomains,
  detectRepairInteractions,
  buildRepairInteractionDiagnostics,
} from "../src/rules/shared/workflow-interaction.ts";
import type { Diagnostic } from "../src/types.ts";
import type { WorkflowDocument } from "../src/workflow.ts";

function finding(ruleId: string, workflow: string): Diagnostic {
  return {
    ruleId,
    severity: "warning",
    confidence: "high",
    workflow,
    docsPath: "",
    location: { path: workflow, line: 1, column: 1 },
    message: "",
    why: "",
    suggestion: "",
    measurementHint: "",
    aiHandoff: "",
    score: 0,
  };
}

function makeWorkflow(
  relativePath: string,
  overrides: Partial<WorkflowDocument> & {
    concurrency?: string | { group: string; "cancel-in-progress"?: boolean };
    name?: string;
    onWorkflowRun?: string[];
    onWorkflowCall?: boolean;
  },
): WorkflowDocument {
  const parsed: Record<string, unknown> = {};
  if (overrides.onWorkflowRun) {
    parsed.on = { workflow_run: { workflows: overrides.onWorkflowRun.join(", ") } };
  } else if (overrides.onWorkflowCall) {
    parsed.on = { workflow_call: {} };
  }

  if (overrides.concurrency) {
    parsed.concurrency = overrides.concurrency;
  }

  return {
    path: relativePath,
    relativePath,
    source: "",
    parsed,
    name: overrides.name,
    concurrencyNode: overrides.concurrency
      ? ({ tag: "tag:yaml.org,2002:map", items: [], nodes: [] } as never)
      : undefined,
    jobs: [],
    ...overrides,
  } as WorkflowDocument;
}

describe("normalizeConcurrencyGroup", () => {
  test("collapses ref template variables", () => {
    const id = normalizeConcurrencyGroup("ci-${{ github.ref }}");
    expect(id.normalized).toContain("{ref}");
    expect(id.hasRef).toBe(true);
  });

  test("collapses workflow name", () => {
    const id = normalizeConcurrencyGroup("deploy-${{ github.workflow }}");
    expect(id.normalized).toContain("{workflow}");
    expect(id.hasWorkflow).toBe(true);
  });

  test("collapses head_ref", () => {
    const id = normalizeConcurrencyGroup("test-${{ github.head_ref }}");
    expect(id.normalized).toContain("{ref}");
  });

  test("collapses ref_name", () => {
    const id = normalizeConcurrencyGroup("build-${{ github.ref_name }}");
    expect(id.normalized).toContain("{ref}");
  });

  test("collapses event_name", () => {
    const id = normalizeConcurrencyGroup("ci-${{ github.event_name }}");
    expect(id.normalized).toContain("{event}");
    expect(id.hasEvent).toBe(true);
  });

  test("normalized form is consistent across equivalent groups", () => {
    const a = normalizeConcurrencyGroup("ci-${{ github.ref }}");
    const b = normalizeConcurrencyGroup("ci-${{ github.ref_name }}");
    expect(concurrencyGroupsEqual(a, b)).toBe(true);
  });

  test("normalized form differs for different groups", () => {
    const a = normalizeConcurrencyGroup("ci-${{ github.ref }}");
    const b = normalizeConcurrencyGroup("deploy-${{ github.ref }}");
    expect(concurrencyGroupsEqual(a, b)).toBe(false);
  });

  test("lowercases and normalizes whitespace", () => {
    const id = normalizeConcurrencyGroup("CI-${{ github.WORKFLOW }}");
    expect(id.normalized).toBe("ci-{workflow}");
  });
});

describe("parseConcurrencyGroup", () => {
  test("parses string group", () => {
    const wf = makeWorkflow("test.yml", { concurrency: "ci-${{ github.ref }}" });
    const group = parseConcurrencyGroup(wf);
    expect(group?.raw).toBe("ci-${{ github.ref }}");
    expect(group?.cancelInProgress).toBe(false);
  });

  test("parses object group with cancel-in-progress", () => {
    const wf = makeWorkflow("test.yml", {
      concurrency: { group: "ci-${{ github.ref }}", "cancel-in-progress": true },
    });
    const group = parseConcurrencyGroup(wf);
    expect(group?.raw).toBe("ci-${{ github.ref }}");
    expect(group?.cancelInProgress).toBe(true);
  });

  test("returns undefined for missing concurrency", () => {
    const wf = makeWorkflow("test.yml", {});
    expect(parseConcurrencyGroup(wf)).toBeUndefined();
  });
});

describe("findWorkflowDependencies", () => {
  test("detects workflow_run dependency", () => {
    const ci = makeWorkflow(".github/workflows/ci.yml", { name: "CI" });
    const release = makeWorkflow(".github/workflows/release.yml", {
      name: "Release",
      onWorkflowRun: ["CI"],
    });
    const deps = findWorkflowDependencies([ci, release]);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.source).toBe(".github/workflows/release.yml");
    expect(deps[0]!.target).toBe(".github/workflows/ci.yml");
    expect(deps[0]!.kind).toBe("workflow_run");
  });

  test("returns empty for no dependencies", () => {
    const a = makeWorkflow("a.yml", { name: "A" });
    const b = makeWorkflow("b.yml", { name: "B" });
    const deps = findWorkflowDependencies([a, b]);
    expect(deps).toHaveLength(0);
  });
});

describe("findWorkflowRunDependents", () => {
  test("returns workflows that depend on the given workflow", () => {
    const deps = [
      { source: "release.yml", target: "ci.yml", kind: "workflow_run" as const },
      { source: "deploy.yml", target: "ci.yml", kind: "workflow_run" as const },
    ];
    const dependents = findWorkflowRunDependents("ci.yml", deps);
    expect(dependents).toEqual(["release.yml", "deploy.yml"]);
  });

  test("returns empty for workflows with no dependents", () => {
    const deps = [{ source: "release.yml", target: "ci.yml", kind: "workflow_run" as const }];
    expect(findWorkflowRunDependents("deploy.yml", deps)).toEqual([]);
  });
});

describe("detectConcurrencyDomains", () => {
  test("detects shared concurrency domain", () => {
    const wf1 = makeWorkflow("ci.yml", { concurrency: "ci-${{ github.ref }}" });
    const wf2 = makeWorkflow("test.yml", { concurrency: "ci-${{ github.ref }}" });
    const domains = detectConcurrencyDomains([wf1, wf2]);
    expect(domains).toHaveLength(1);
    expect(domains[0]!.groupText).toBe("ci-{ref}");
    expect(domains[0]!.memberWorkflows).toEqual(["ci.yml", "test.yml"]);
  });

  test("ignores unique groups (no sharing)", () => {
    const wf1 = makeWorkflow("ci.yml", { concurrency: "ci-${{ github.ref }}" });
    const wf2 = makeWorkflow("deploy.yml", { concurrency: "deploy-${{ github.ref }}" });
    const domains = detectConcurrencyDomains([wf1, wf2]);
    expect(domains).toHaveLength(0);
  });

  test("handles no concurrency", () => {
    const wf1 = makeWorkflow("ci.yml", {});
    expect(detectConcurrencyDomains([wf1])).toHaveLength(0);
  });
});

describe("detectRepairInteractions", () => {
  test("detects interference when suggested group matches dependent's existing group", () => {
    const ci = makeWorkflow("ci.yml", { name: "CI" });
    const release = makeWorkflow("release.yml", {
      name: "Release",
      onWorkflowRun: ["CI"],
      concurrency: "${{ github.workflow }}-${{ github.ref }}",
    });

    const workflows = [ci, release];
    const deps = findWorkflowDependencies(workflows);
    const findings = [finding("missing-concurrency", "ci.yml")];

    const interactions = detectRepairInteractions(workflows, findings, deps);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.sourceWorkflow).toBe("ci.yml");
    expect(interactions[0]!.affectedWorkflow).toBe("release.yml");
    expect(interactions[0]!.interaction).toContain("cancel each other");
  });

  test("no interference when dependent concurrency group differs from suggested", () => {
    const ci = makeWorkflow("ci.yml", { name: "CI" });
    const release = makeWorkflow("release.yml", {
      name: "Release",
      onWorkflowRun: ["CI"],
      concurrency: "release-${{ github.ref }}",
    });

    const workflows = [ci, release];
    const deps = findWorkflowDependencies(workflows);
    const findings = [finding("missing-concurrency", "ci.yml")];

    const interactions = detectRepairInteractions(workflows, findings, deps);
    expect(interactions).toHaveLength(0);
  });

  test("no interactions when no workflow_run dependencies", () => {
    const ci = makeWorkflow("ci.yml", { name: "CI" });
    const build = makeWorkflow("build.yml", { name: "Build" });
    const workflows = [ci, build];
    const deps = findWorkflowDependencies(workflows);
    const findings = [finding("missing-concurrency", "ci.yml")];

    const interactions = detectRepairInteractions(workflows, findings, deps);
    expect(interactions).toHaveLength(0);
  });

  test("no interactions when no missing-concurrency findings", () => {
    const ci = makeWorkflow("ci.yml", { name: "CI" });
    const release = makeWorkflow("release.yml", { name: "Release", onWorkflowRun: ["CI"] });
    const workflows = [ci, release];
    const deps = findWorkflowDependencies(workflows);
    const interactions = detectRepairInteractions(workflows, [], deps);
    expect(interactions).toHaveLength(0);
  });

  test("buildRepairInteractionDiagnostics produces diagnostics", () => {
    const ci = makeWorkflow("ci.yml", { name: "CI" });
    const release = makeWorkflow("release.yml", {
      name: "Release",
      onWorkflowRun: ["CI"],
      concurrency: "${{ github.workflow }}-${{ github.ref }}",
    });
    const workflows = [ci, release];
    const deps = findWorkflowDependencies(workflows);
    const findings = [finding("missing-concurrency", "ci.yml")];

    const meta = {
      id: "repair-concurrency-interaction",
      severity: "warning" as const,
      confidence: "medium" as const,
      docsPath: "docs/rules/repair-concurrency-interaction.md",
    };

    const diags = buildRepairInteractionDiagnostics(workflows, findings, deps, meta);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("repair-concurrency-interaction");
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[0]!.message).toContain("cancel each other");
    expect(diags[0]!.workflow).toBe("ci.yml");
  });
});
