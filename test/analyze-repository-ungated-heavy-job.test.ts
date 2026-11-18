import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const heavyJob = {
  "runs-on": "ubuntu-latest",
  steps: [{ run: "pnpm install --frozen-lockfile\npnpm build" }],
};

async function findings({
  on = ["push", "pull_request"],
  condition,
  concurrency,
  jobs,
  complex = true,
}: {
  on?: unknown;
  condition?: unknown;
  concurrency?: unknown;
  jobs?: Record<string, unknown>;
  complex?: boolean;
} = {}) {
  const cwd = await tempDirs.create("apl-ungated-");
  await writeRepositoryFiles(cwd, {
    ...(complex ? { "pnpm-workspace.yaml": "packages:\n  - apps/*\n" } : {}),
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on,
      concurrency,
      jobs: jobs ?? { build: { ...heavyJob, if: condition } },
    }),
  });
  const report = await getWorkflowFocusedFixtureReport(cwd, { targetPath: ".", topCount: 100 });
  return report.findings.filter((finding) => finding.ruleId === "ungated-heavy-job");
}

describe("ungated-heavy-job requires absence of workflow and job filters", () => {
  test("warns for completely unfiltered heavy work in strict mode", async () => {
    const matches = await findings();
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("no workflow branch/tag/path filter");
  });

  test.each([
    { push: { branches: ["main"] } },
    { push: { "branches-ignore": ["release/**"] } },
    { push: { tags: ["v*"] } },
    { push: { "tags-ignore": ["v*"] } },
    { push: { paths: ["src/**"] } },
    { push: { "paths-ignore": ["docs/**"] } },
    { pull_request: { branches: ["main"] } },
    { pull_request: { "branches-ignore": ["release/**"] } },
    { pull_request: { paths: ["src/**"] } },
    { pull_request: { "paths-ignore": ["docs/**"] } },
    { push: { tags: ["v*"] }, workflow_dispatch: {} },
    { push: {}, pull_request: { paths: ["src/**"] } },
    "workflow_dispatch",
    { schedule: [{ cron: "0 0 * * *" }] },
  ])("accepts workflow filtering or non-push/PR triggers: %j", async (on) => {
    expect(await findings({ on })).toHaveLength(0);
  });

  test.each([true, "true", "${{ true }}", "success()", "${{ success() }}", "always()"])(
    "does not mistake a trivial condition for selection: %j",
    async (condition) => {
      expect(await findings({ condition })).toHaveLength(1);
    },
  );

  test.each([
    false,
    "false",
    "${{ false }}",
    "github.ref == 'refs/heads/main'",
    "needs.changes.outputs.build == 'true'",
    "${{ inputs.run_build }}",
  ])("accepts a disabled job or an execution condition: %j", async (condition) => {
    expect(await findings({ condition })).toHaveLength(0);
  });

  test("concurrency alone is not a branch or change filter", async () => {
    expect(
      await findings({
        concurrency: {
          group: "${{ github.workflow }}-${{ github.ref }}",
          "cancel-in-progress": true,
        },
      }),
    ).toHaveLength(1);
  });

  test.each(["select", ["select"]])("inherits filtering through needs: %j", async (needs) => {
    expect(
      await findings({
        jobs: {
          select: {
            "runs-on": "ubuntu-latest",
            if: "github.ref == 'refs/heads/main'",
            steps: [{ run: "echo selected" }],
          },
          build: { ...heavyJob, needs },
        },
      }),
    ).toHaveLength(0);
  });

  test("inherits selection through multiple dependency levels", async () => {
    expect(
      await findings({
        jobs: {
          select: {
            "runs-on": "ubuntu-latest",
            if: "github.ref == 'refs/heads/main'",
            steps: [{ run: "echo selected" }],
          },
          prepare: {
            "runs-on": "ubuntu-latest",
            needs: "select",
            steps: [{ run: "echo prepared" }],
          },
          build: { ...heavyJob, needs: "prepare" },
        },
      }),
    ).toHaveLength(0);
  });

  test("always overrides an upstream gate instead of inheriting selection", async () => {
    const matches = await findings({
      jobs: {
        select: {
          "runs-on": "ubuntu-latest",
          if: "github.ref == 'refs/heads/main'",
          steps: [{ run: "echo selected" }],
        },
        build: { ...heavyJob, needs: "select", if: "always()" },
      },
    });
    expect(matches).toHaveLength(1);
  });

  test("an always() job that summarizes needs results is a required-check reporter", async () => {
    expect(
      await findings({
        jobs: {
          select: {
            "runs-on": "ubuntu-latest",
            if: "github.ref == 'refs/heads/main'",
            steps: [{ run: "echo selected" }],
          },
          "fast-tests": {
            "runs-on": "ubuntu-latest",
            needs: "select",
            if: "always()",
            "timeout-minutes": 5,
            steps: [
              {
                name: "Summarize upstream test results",
                env: { SELECT_RESULT: "${{ needs.select.result }}" },
                run: [
                  "set -euo pipefail",
                  "failures=()",
                  "record_failure() {",
                  '  failures+=("$1: $2")',
                  "}",
                  "require_success() {",
                  '  local job="$1"',
                  '  local result="$2"',
                  '  if [[ "$result" != "success" ]]; then record_failure "$job" "did not succeed"; fi',
                  "}",
                  'require_success "Select" "$SELECT_RESULT"',
                ].join("\n"),
              },
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("an always() job doing real work without needs verdicts still reports", async () => {
    expect(
      await findings({
        jobs: {
          select: {
            "runs-on": "ubuntu-latest",
            if: "github.ref == 'refs/heads/main'",
            steps: [{ run: "echo selected" }],
          },
          "fast-tests": {
            ...heavyJob,
            needs: "select",
            if: "always()",
          },
        },
      }),
    ).toHaveLength(1);
  });

  test("an always() job reading toJSON(needs) is also a reporter", async () => {
    expect(
      await findings({
        jobs: {
          select: {
            "runs-on": "ubuntu-latest",
            if: "github.ref == 'refs/heads/main'",
            steps: [{ run: "echo selected" }],
          },
          "build-gate": {
            "runs-on": "ubuntu-latest",
            needs: "select",
            if: "always()",
            steps: [
              {
                name: "Gate on scoped build results",
                env: { NEEDS_JSON: "${{ toJSON(needs) }}" },
                run: [
                  "set -euo pipefail",
                  "check() {",
                  '  local job="$1"',
                  '  local result="$2"',
                  '  if [[ "$result" != "success" ]]; then echo "::error::$job failed"; exit 1; fi',
                  "}",
                  'node -e "const needs = JSON.parse(process.env.NEEDS_JSON); process.exit(0)"',
                ].join("\n"),
              },
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("a change-selection producer job is the gate itself, not ungated work", async () => {
    const gatedConsumer = (key: string) => ({
      ...heavyJob,
      needs: "change-scope",
      if: `needs.change-scope.outputs.${key} == 'true'`,
    });
    expect(
      await findings({
        jobs: {
          "change-scope": {
            "runs-on": "ubuntu-latest",
            outputs: { build: "${{ steps.scope.outputs.build }}" },
            steps: [
              { run: "pnpm install --frozen-lockfile" },
              { id: "scope", run: "node scripts/scope.js" },
            ],
          },
          build: gatedConsumer("build"),
          lint: gatedConsumer("lint"),
          test: gatedConsumer("test"),
        },
      }),
    ).toHaveLength(0);
  });

  test("a producer whose outputs gate too few jobs is not exempt", async () => {
    expect(
      await findings({
        jobs: {
          "change-scope": {
            "runs-on": "ubuntu-latest",
            outputs: { build: "${{ steps.scope.outputs.build }}" },
            steps: [
              { run: "pnpm install --frozen-lockfile" },
              { id: "scope", run: "node scripts/scope.js" },
            ],
          },
          build: {
            ...heavyJob,
            needs: "change-scope",
            if: "needs.change-scope.outputs.build == 'true'",
          },
        },
      }),
    ).toHaveLength(1);
    expect(
      (
        await findings({
          jobs: {
            "change-scope": {
              "runs-on": "ubuntu-latest",
              outputs: { build: "${{ steps.scope.outputs.build }}" },
              steps: [
                { run: "pnpm install --frozen-lockfile" },
                { id: "scope", run: "node scripts/scope.js" },
              ],
            },
            build: {
              ...heavyJob,
              needs: "change-scope",
              if: "needs.change-scope.outputs.build == 'true'",
            },
          },
        })
      )[0]?.message,
    ).toContain('"change-scope"');
  });

  test("one gated sibling does not hide unfiltered work", async () => {
    const matches = await findings({
      jobs: {
        gated: { ...heavyJob, if: "github.ref == 'refs/heads/main'" },
        build: heavyJob,
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain('"build"');
  });

  test("preserves small-repository and non-executable-work exclusions", async () => {
    expect(await findings({ complex: false })).toHaveLength(0);
    expect(
      await findings({
        jobs: { build: { "runs-on": "ubuntu-latest", steps: [{ run: "echo build" }] } },
      }),
    ).toHaveLength(0);
  });
});
