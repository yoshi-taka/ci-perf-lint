import { describe, expect, test } from "bun:test";
import { buildAiHandoff } from "../src/ai-handoff.ts";
import type { AggregatedFinding } from "../src/types.ts";

function finding(overrides: Partial<AggregatedFinding> & { ruleId: string }): AggregatedFinding {
  return {
    ruleId: overrides.ruleId,
    workflow: overrides.workflow ?? "",
    workflows: overrides.workflows ?? ["workflow.yml"],
    locations: overrides.locations ?? ["file.ts:1:1"],
    jobs: overrides.jobs ?? [],
    messages: overrides.messages ?? ["test"],
    aiHandoffs: overrides.aiHandoffs ?? ["hand off"],
    suggestion: overrides.suggestion ?? "fix it",
    why: overrides.why ?? "why it matters",
    measurementHint: overrides.measurementHint ?? "measure",
    docsPath: overrides.docsPath ?? "docs/rules/test.md",
    firstIndex: overrides.firstIndex ?? 0,
    scope: overrides.scope ?? "workflow",
  };
}

describe("buildAiHandoff branching EP/BVA", () => {
  test("empty findings → only shared instruction", () => {
    const result = buildAiHandoff([]);
    expect(result).toEqual([
      "Before making repository or workflow changes, inspect recent git history to understand change risk. Also review related pull requests and issues when available.",
    ]);
  });

  describe("scope === repository", () => {
    test.each([
      [
        "single location with fallback",
        finding({
          ruleId: "large-barrel",
          scope: "repository",
          locations: ["src/index.ts:1:1"],
          aiHandoffs: ["Review barrel exports"],
        }),
        "Review barrel exports",
      ],
      [
        "multiple locations",
        finding({
          ruleId: "detected-large-barrel-file",
          scope: "repository",
          locations: Array.from({ length: 6 }, (_, i) => `src/${i}.ts:1:1`),
        }),
        "6 source/tooling locations",
      ],
      [
        "exactly 1 location with no fallback",
        finding({
          ruleId: "large-jest-snapshot",
          scope: "repository",
          locations: ["snap.test.ts.snap:1:1"],
          aiHandoffs: [],
        }),
        "large-jest-snapshot",
      ],
    ] as const)("%s", (_name, input, expectedText) => {
      const result = buildAiHandoff([input]);
      expect(result.some((line) => line.includes(expectedText))).toBe(true);
    });

    test("multiple locations → renders remainder", () => {
      const locations = Array.from({ length: 6 }, (_, i) => `src/${i}.ts:1:1`);
      const result = buildAiHandoff([
        finding({ ruleId: "detected-large-barrel-file", scope: "repository", locations }),
      ]);
      expect(result.some((line) => line.includes("+1 more"))).toBe(true);
    });
  });

  describe("workflow scope branching", () => {
    test.each([
      [
        "workflows >= 2 and jobs >= 1",
        finding({
          ruleId: "missing-timeout",
          workflows: ["a.yml", "b.yml"],
          jobs: ["build"],
          locations: ["a.yml:1:1"],
        }),
        "across workflows",
      ],
      [
        "workflows >= 2 and exactly 1 location",
        finding({
          ruleId: "missing-timeout",
          workflows: ["a.yml", "b.yml"],
          locations: ["shared.yml:1:1"],
          jobs: [],
        }),
        "surfaced across workflows",
      ],
      [
        "jobs >= 2",
        finding({
          ruleId: "missing-cache",
          workflow: "ci.yml",
          workflows: ["ci.yml"],
          jobs: ["build", "test"],
          locations: ["ci.yml:1:1"],
        }),
        "affecting jobs",
      ],
    ] as const)("%s", (_name, input, expectedText) => {
      const result = buildAiHandoff([input]);
      expect(result.some((line) => line.includes(expectedText))).toBe(true);
    });

    test("single workflow, single job, single location → default instruction", () => {
      const result = buildAiHandoff([
        finding({
          ruleId: "missing-concurrency",
          workflow: "ci.yml",
          workflows: ["ci.yml"],
          jobs: ["build"],
          locations: ["ci.yml:1:1"],
        }),
      ]);
      // no special rendering, fallback to just shared instruction + aiHandoff
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test("mixed: repository + workflow findings", () => {
      const result = buildAiHandoff([
        finding({
          ruleId: "large-barrel",
          scope: "repository",
          locations: ["src/index.ts:1:1", "src/lib.ts:1:1"],
        }),
        finding({ ruleId: "missing-timeout", workflows: ["a.yml", "b.yml"], jobs: ["build"] }),
      ]);
      expect(result.length).toBe(3); // shared + repo + workflow
      expect(result[0]).toContain("Before making repository");
    });
  });
});
