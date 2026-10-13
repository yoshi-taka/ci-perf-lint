import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";
import type { RuleMeta } from "../src/types.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyze(
  jobs: Record<string, unknown>,
  rule: Pick<RuleMeta, "id" | "severity">,
  files: Record<string, string> = {},
) {
  const root = await tempDirs.create("apl-workflow-audit-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: { push: { branches: ["main"] } },
      jobs,
    }),
    ...files,
  });
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", topCount: 1, mode: "exploratory", workflowOnly: true },
    rule,
  );
  return report.findings.filter((finding) => finding.ruleId === rule.id);
}

describe("workflow audit: completeness and release status conditions", () => {
  test.each([3, 4, 5])("retains all %i cache findings despite display top=1", async (count) => {
    const jobs = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `test${i}`,
        {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/setup-python@v7", with: { "python-version": "3.13" } },
            { run: "python -m pip install -r requirements-dev.txt" },
          ],
        },
      ]),
    );
    const findings = await analyze(jobs, {
      id: "missing-dependency-cache",
      severity: "suggestion",
    });
    expect(findings).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      expect(findings.some((finding) => finding.message.includes(`job "test${i}"`))).toBe(true);
    }
  });

  test.each([
    { condition: undefined, expected: false },
    { condition: "startsWith(github.ref, 'refs/tags/')", expected: false },
    { condition: "github.event_name == 'push'", expected: false },
    { condition: "success()", expected: false },
    { condition: "${{ success( ) }}", expected: false },
    { condition: "always()", expected: true },
    { condition: "always( ) && github.event_name == 'push'", expected: true },
    { condition: "!cancelled() && github.event_name == 'push'", expected: true },
    { condition: "always() && needs.build.outputs.ready == 'true'", expected: true },
    { condition: "always() && needs.build.result == 'skipped'", expected: true },
    {
      condition: "always() && needs.build.result == 'success' && github.event_name == 'push'",
      expected: false,
    },
    {
      condition:
        "always() && needs.build.result == 'success' && needs.build.outputs.ready == 'true'",
      expected: false,
    },
    {
      condition: "always() && !failure() && !cancelled() && github.event_name == 'push'",
      expected: false,
    },
    {
      condition: "always() && !failure() && !cancelled() && needs.build.result == 'skipped'",
      expected: false,
    },
  ])("release condition: $condition", async ({ condition, expected }) => {
    const findings = await analyze(
      {
        build: { "runs-on": "ubuntu-latest", steps: [{ run: "exit 1" }] },
        publish: {
          needs: "build",
          if: condition,
          "runs-on": "ubuntu-latest",
          steps: [{ run: "echo publish" }],
        },
      },
      { id: "missing-release-downstream-success-guard", severity: "warning" },
    );
    expect(findings.length).toBe(expected ? 1 : 0);
    if (expected) {
      expect(findings[0]?.severity).toBe("warning");
    }
  });
  test("preserves explicit required-success and optional-skipped release dependencies", async () => {
    const findings = await analyze(
      {
        build: { "runs-on": "ubuntu-latest", steps: [{ run: "echo build" }] },
        optional: { "runs-on": "ubuntu-latest", steps: [{ run: "echo optional" }] },
        publish: {
          needs: ["build", "optional"],
          if:
            "always() && needs.build.result == 'success' && " +
            "(needs.optional.result == 'success' || needs.optional.result == 'skipped')",
          "runs-on": "ubuntu-latest",
          steps: [{ run: "echo publish" }],
        },
      },
      { id: "missing-release-downstream-success-guard", severity: "warning" },
    );
    expect(findings).toHaveLength(0);
  });
});

describe("workflow audit: compatibility and component scope", () => {
  test.each([
    { versions: ["3.10", "3.13"], fixed: undefined, expected: false },
    { versions: ["3.9", "3.10"], fixed: undefined, expected: true },
    { versions: ["3.10", "3.13"], fixed: "3.10", expected: true },
  ])("Python matrix $versions / fixed $fixed", async ({ versions, fixed, expected }) => {
    const findings = await analyze(
      {
        test: {
          "runs-on": "ubuntu-latest",
          strategy: { matrix: { "python-version": versions } },
          steps: [
            {
              uses: "actions/setup-python@v7",
              with: { "python-version": fixed ?? "${{ matrix.python-version }}" },
            },
            { run: "python -m pytest tests" },
          ],
        },
      },
      { id: "prefer-python-3-11", severity: "warning" },
    );
    expect(findings.length).toBe(expected ? 1 : 0);
    if (expected) {
      expect(findings[0]?.aiHandoff).toContain("Preserve supported-version");
    }
  });

  test("monorepo markers do not turn aggregate test jobs into component jobs", async () => {
    const findings = await analyze(
      {
        changed: {
          "runs-on": "ubuntu-latest",
          steps: [{ uses: "tj-actions/changed-files@v47" }],
        },
        test: {
          needs: "changed",
          if: "needs.changed.outputs.should_skip != 'true'",
          "runs-on": "ubuntu-latest",
          steps: [{ run: "pnpm run test" }],
        },
        "test-passed": { "runs-on": "ubuntu-slim", steps: [{ run: 'echo "Build Passed"' }] },
        "test-failed": { "runs-on": "ubuntu-slim", steps: [{ run: 'echo "Build Failed"' }] },
        lint: { "runs-on": "ubuntu-latest", steps: [{ run: "pnpm run lint" }] },
      },
      { id: "prefer-dorny-paths-filter-for-scoped-jobs", severity: "suggestion" },
      { "pnpm-workspace.yaml": "packages:\n  - apps/*\n" },
    );
    expect(findings).toHaveLength(0);
  });

  test("still suggests gates for two ungated heavy component jobs", async () => {
    const findings = await analyze(
      {
        backend: { "runs-on": "ubuntu-latest", steps: [{ run: "pnpm run test:api" }] },
        frontend: { "runs-on": "ubuntu-latest", steps: [{ run: "pnpm run test:web" }] },
      },
      { id: "prefer-dorny-paths-filter-for-scoped-jobs", severity: "suggestion" },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"backend"');
    expect(findings[0]?.message).toContain('"frontend"');
  });
});
