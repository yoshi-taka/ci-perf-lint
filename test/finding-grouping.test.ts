import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
  mergeSingleJobCrossWorkflowEntries,
  normalizeWorkflowText,
} from "../src/finding-grouping.ts";

interface GroupingEntry {
  workflow: string;
  ruleId: string;
  workflows: string[];
  jobs: string[];
  firstIndex: number;
  scope?: "workflow" | "repository";
  locations: string[];
}

describe("finding grouping helpers", () => {
  test("replaces every workflow path occurrence with a placeholder", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\.github\/workflows\/[a-z]{1,8}\.yml$/),
        fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
        (workflow, parts) => {
          const text = parts.join(workflow);
          const normalized = normalizeWorkflowText(text, workflow);
          const expectedPlaceholderCount = Math.max(parts.length - 1, 0);

          expect(normalized).toBe(parts.join("<workflow>"));
          expect(normalized.split("<workflow>").length - 1).toBe(expectedPlaceholderCount);
        },
      ),
    );
  });

  test("merges entries sharing one key and keeps the smallest first index", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 100 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (firstIndexes) => {
          const entries: GroupingEntry[] = firstIndexes.map((firstIndex, index) => ({
            workflow: `.github/workflows/workflow-${index + 1}.yml`,
            ruleId: "missing-timeout-minutes",
            workflows: [`.github/workflows/workflow-${index + 1}.yml`],
            jobs: ["build"],
            firstIndex,
            locations: [`.github/workflows/workflow-${index + 1}.yml:${index + 1}:3`],
          }));
          const expectedWorkflows = entries.flatMap((entry) => entry.workflows);
          const expectedLocations = entries.flatMap((entry) => entry.locations);

          const merged = mergeSingleJobCrossWorkflowEntries(
            entries,
            () => "shared-key",
            (target, source) => {
              target.workflows.push(...source.workflows);
              target.locations.push(...source.locations);
            },
          );

          expect(merged).toHaveLength(1);
          expect(merged[0]?.firstIndex).toBe(Math.min(...firstIndexes));
          expect(merged[0]?.workflows).toEqual(expectedWorkflows);
          expect(merged[0]?.locations).toEqual(expectedLocations);
        },
      ),
    );
  });

  test("leaves repository entries unmerged and sorts them by first index", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 100 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (firstIndexes) => {
          const entries: GroupingEntry[] = firstIndexes.map((firstIndex, index) => ({
            workflow: `.github/workflows/workflow-${index + 1}.yml`,
            ruleId: "prefer-explicit-import-extensions",
            workflows: [],
            jobs: ["build"],
            firstIndex,
            scope: "repository",
            locations: [`src/file-${index + 1}.ts:1:1`],
          }));

          const merged = mergeSingleJobCrossWorkflowEntries(
            entries,
            () => "shared-key",
            () => {
              throw new Error("repository entries should not merge");
            },
          );

          expect(merged).toHaveLength(entries.length);
          expect(merged.map((entry) => entry.firstIndex)).toEqual(
            [...firstIndexes].sort((left, right) => left - right),
          );
        },
      ),
    );
  });

  test("does not merge workflow entries with multiple affected jobs by default", () => {
    const entries: GroupingEntry[] = [
      {
        workflow: ".github/workflows/release-a.yml",
        ruleId: "missing-timeout-minutes",
        workflows: [".github/workflows/release-a.yml"],
        jobs: ["build", "publish"],
        firstIndex: 2,
        locations: [".github/workflows/release-a.yml:10:3"],
      },
      {
        workflow: ".github/workflows/release-b.yml",
        ruleId: "missing-timeout-minutes",
        workflows: [".github/workflows/release-b.yml"],
        jobs: ["build", "publish"],
        firstIndex: 1,
        locations: [".github/workflows/release-b.yml:12:3"],
      },
    ];

    const merged = mergeSingleJobCrossWorkflowEntries(
      entries,
      () => "shared-key",
      () => {
        throw new Error("entries with multiple jobs should not merge by default");
      },
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.firstIndex)).toEqual([1, 2]);
    expect(merged.map((entry) => entry.workflow)).toEqual([
      ".github/workflows/release-b.yml",
      ".github/workflows/release-a.yml",
    ]);
  });
});
