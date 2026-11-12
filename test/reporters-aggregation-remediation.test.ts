import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { aggregateFindingsWithMembers } from "../src/reporters.ts";
import type { Diagnostic } from "../src/types.ts";
import { assertRuleTestReport, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());

function finding(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    ruleId: "prefer-frozen-lockfile",
    severity: "warning",
    confidence: "high",
    docsPath: "docs/rules/prefer-frozen-lockfile.md",
    workflow: ".github/workflows/ci.yml",
    location: { path: ".github/workflows/ci.yml", line: 7, column: 1 },
    message: 'Job "pnpm" uses pnpm without a frozen lockfile.',
    why: "Dependency resolution may change the lockfile.",
    suggestion: "Use pnpm install --frozen-lockfile.",
    measurementHint: "Compare install duration.",
    aiHandoff: "Enable frozen lockfile behavior for pnpm.",
    score: 55,
    ...overrides,
  };
}

describe("aggregation preserves distinct remediation guidance", () => {
  for (const scope of ["workflow", "repository", "mixed"] as const) {
    for (const field of ["suggestion", "measurementHint", "docsPath"] as const) {
      for (const reversed of [false, true]) {
        test(`${scope}: distinct ${field}, reversed=${reversed}`, () => {
          const first = finding({ scope: scope === "workflow" ? "workflow" : "repository" });
          const second = finding({
            scope: scope === "repository" ? "repository" : "workflow",
            [field]: `Different ${field}`,
            location: { path: ".github/workflows/ci.yml", line: 11, column: 1 },
          });
          const input = reversed ? [second, first] : [first, second];
          const { aggregatedFindings, memberFindings } = aggregateFindingsWithMembers(input);

          expect(aggregatedFindings).toHaveLength(2);
          expect(aggregatedFindings.map((group) => group[field])).toEqual(
            input.map((diagnostic) => diagnostic[field]),
          );
          expect(memberFindings).toEqual(input.map((diagnostic) => [diagnostic]));
          expect(aggregatedFindings.map((group) => group.firstIndex)).toEqual([0, 1]);
        });
      }
    }
  }

  test("repository merging combines only compatible workflow groups", () => {
    const repository = finding({ scope: "repository", workflow: "package.json" });
    const workflow = finding();
    const other = finding({
      workflow: ".github/workflows/other.yml",
      suggestion: "Use bun ci.",
    });
    const compatible = finding({ workflow: ".github/workflows/release.yml" });

    for (const input of [
      [repository, workflow, other, compatible],
      [compatible, other, workflow, repository],
    ]) {
      const { aggregatedFindings, memberFindings } = aggregateFindingsWithMembers(input);
      expect(aggregatedFindings).toHaveLength(2);
      const mergedIndex = aggregatedFindings.findIndex(
        (group) => group.suggestion === repository.suggestion,
      );
      const merged = aggregatedFindings[mergedIndex];
      expect(merged?.scope).toBe("repository");
      expect(new Set(merged?.workflows)).toEqual(
        new Set([repository.workflow, workflow.workflow, compatible.workflow]),
      );
      expect(new Set(memberFindings[mergedIndex])).toEqual(
        new Set([repository, workflow, compatible]),
      );
      expect(
        aggregatedFindings.find((group) => group.suggestion === other.suggestion)?.scope,
      ).not.toBe("repository");
      expect(memberFindings.flat()).toHaveLength(input.length);
    }
  });

  for (const managers of [
    ["pnpm", "bun"],
    ["bun", "pnpm"],
  ]) {
    test(`fixFirst keeps both package-manager instructions: ${managers.join(", ")}`, async () => {
      const repoRoot = await tempDirs.create("apl-remediation-guidance-");
      await writeRepositoryFiles(repoRoot, {
        ".github/workflows/ci.yml": [
          "name: CI",
          "on: push",
          "jobs:",
          ...managers.flatMap((manager) => [
            `  ${manager}:`,
            "    runs-on: ubuntu-latest",
            "    steps:",
            `      - run: ${manager} install --no-frozen-lockfile`,
          ]),
          "",
        ].join("\n"),
      });
      const report = await analyzeRepository({
        cwd: repoRoot,
        targetPath: ".",
        topCount: 100,
        mode: "exploratory",
      });
      const rule = { id: "prefer-frozen-lockfile", severity: "warning" } as const;
      assertRuleTestReport(report, rule, "exploratory");
      const raw = report.findings.filter((diagnostic) => diagnostic.ruleId === rule.id);
      const groups = report.topAggregatedFindings.filter((group) => group.ruleId === rule.id);
      const suggestions = [
        "Commit a current lockfile and use pnpm install --frozen-lockfile.",
        "Commit a current lockfile and use bun ci or bun install --frozen-lockfile.",
      ];
      expect(raw).toHaveLength(2);
      expect(groups).toHaveLength(2);
      expect(new Set(groups.map((group) => group.suggestion))).toEqual(new Set(suggestions));
      for (const suggestion of suggestions) {
        expect(report.fixFirst).toContain(suggestion);
      }
    });
  }
});
