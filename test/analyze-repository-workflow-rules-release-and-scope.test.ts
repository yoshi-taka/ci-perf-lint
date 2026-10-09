import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, getWorkflowFocusedFixtureReport } from "./helpers.ts";
import type { memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return getWorkflowFocusedFixtureReport(cwd, options);
}

describe("analyzeRepository workflow and execution rules: release and scope", () => {
  test("suggests dispatch response IDs for PostHog-style discovery, only in exploratory mode", async () => {
    const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };
    const report = await getFixtureReport(fixtures.dispatchRunDiscoveryLike, options);
    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-workflow-dispatch-run-details",
    );
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.location.path).toBe(".github/workflows/ci.yml");
    expect(finding?.suggestion).toContain("workflow_run_id");
    const strict = await getFixtureReport(fixtures.dispatchRunDiscoveryLike, {
      ...options,
      mode: "strict",
    });
    expect(
      strict.findings.some(
        (candidate) => candidate.ruleId === "prefer-workflow-dispatch-run-details",
      ),
    ).toBe(false);
  });

  test("does not flag completion polling for a dispatched run", async () => {
    const report = await getFixtureReport(fixtures.dispatchRunDiscoveryOk, {
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-workflow-dispatch-run-details",
      ),
    ).toBe(false);
  });

  const dispatch = 'gh api "repos/$repo/actions/workflows/$workflow/dispatches" -f ref=main';
  const listing =
    'run_id=$(gh api "repos/$repo/actions/workflows/$workflow/runs?event=workflow_dispatch" --jq ".workflow_runs[0].id")';
  const discovery = `for attempt in 1 2 3; do\n  sleep 5\n  ${listing}\ndone`;
  test.each([
    {
      name: "gh workflow run with discovery",
      run: `gh workflow run ci.yml --ref main\n${discovery}`,
      expected: true,
    },
    {
      name: "captured CLI URL with compatibility fallback",
      run: `run_url=$(gh workflow run ci.yml --ref main)\n${discovery}`,
      expected: false,
    },
    {
      name: "CLI dispatch with completion waiting only",
      run: "gh workflow run ci.yml\nwhile true; do\n sleep 5\n gh run view 123 --json status\ndone",
      expected: false,
    },
    {
      name: "printed CLI dispatch example",
      run: `echo 'gh workflow run ci.yml'\n${discovery}`,
      expected: false,
    },
    {
      name: "while loop with gh run list",
      run: `${dispatch}\nwhile true; do\n sleep 5\n run_id=$(gh run list --workflow ci.yml --json databaseId --jq '.[0].databaseId')\ndone`,
      expected: true,
    },
    {
      name: "repository-wide run list",
      run: `${dispatch}\n${discovery.replace("/workflows/$workflow", "")}`,
      expected: true,
    },
    {
      name: "comments around continued commands",
      run: `# Dispatch and discover\n${dispatch} \\\n -F return_run_details=false # legacy\n${discovery}`,
      expected: true,
    },
    {
      name: "explicit details with compatibility fallback",
      run: `${dispatch} -F return_run_details=true\n${discovery}`,
      expected: false,
    },
    {
      name: "JSON details with compatibility fallback",
      run: `${dispatch} --input - <<< '{"return_run_details": true}'\n${discovery}`,
      expected: false,
    },
    { name: "listing before dispatch", run: `${discovery}\n${dispatch}`, expected: false },
    {
      name: "repository_dispatch",
      run: `gh api "repos/$repo/dispatches" -f event_type=build\n${discovery}`,
      expected: false,
    },
    {
      name: "dispatch without discovery",
      run: `${dispatch}\ngh run watch 123 --exit-status`,
      expected: false,
    },
    {
      name: "known-run completion polling without details flag",
      run: `${dispatch}\nwhile true; do\n sleep 5\n status=$(gh api "repos/$repo/actions/runs/$run_id" --jq '.id, .status')\ndone`,
      expected: false,
    },
    { name: "commented-out dispatch", run: `# ${dispatch}\n${discovery}`, expected: false },
    { name: "printed dispatch example", run: `echo '${dispatch}'\n${discovery}`, expected: false },
    {
      name: "sleep outside the listing loop",
      run: `${dispatch}\nsleep 5\n${discovery.replace("  sleep 5\n", "")}`,
      expected: false,
    },
    {
      name: "sleep in a separate loop",
      run: `${dispatch}\nfor i in 1 2; do\n sleep 5\ndone\nfor i in 1 2; do\n ${listing}\ndone`,
      expected: false,
    },
    {
      name: "run list without ID extraction",
      run: `${dispatch}\n${discovery.replace(".workflow_runs[0].id", ".workflow_runs[0].status")}`,
      expected: false,
    },
  ])("dispatch discovery: $name", async ({ run, expected }) => {
    const root = await tempDirs.create("apl-dispatch-discovery-");
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "ci.yml"),
      stringify({
        name: "Dispatch",
        on: "workflow_dispatch",
        jobs: { dispatch: { "runs-on": "ubuntu-latest", steps: [{ run }] } },
      }),
    );
    const report = await getFixtureReport(root, {
      targetPath: ".",
      topCount: 100,
      mode: "exploratory",
    });
    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-workflow-dispatch-run-details",
      ),
    ).toBe(expected);
  });

  test.each([
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "workflow_dispatch",
      discover: true,
      expected: true,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2.0.4",
      method: "workflow_dispatch",
      discover: "true",
      expected: true,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v3",
      method: "workflow_dispatch",
      discover: true,
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "repository_dispatch",
      discover: true,
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "workflow_dispatch",
      discover: false,
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "workflow_dispatch",
      discover: "false",
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "workflow_dispatch",
      discover: undefined,
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "${{ inputs.method }}",
      discover: true,
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@v2",
      method: "workflow_dispatch",
      discover: "${{ inputs.discover }}",
      expected: false,
    },
    {
      uses: "lasith-kg/dispatch-workflow@0123456789012345678901234567890123456789",
      method: "workflow_dispatch",
      discover: true,
      expected: false,
    },
  ])(
    "lasith discovery: $uses / $method / $discover",
    async ({ uses, method, discover, expected }) => {
      const root = await tempDirs.create("apl-lasith-discovery-");
      await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
      await writeFile(
        path.join(root, ".github", "workflows", "ci.yml"),
        stringify({
          name: "Dispatch",
          on: "workflow_dispatch",
          jobs: {
            dispatch: {
              "runs-on": "ubuntu-latest",
              steps: [
                {
                  uses,
                  with: { "dispatch-method": method, discover },
                },
              ],
            },
          },
        }),
      );
      const report = await getFixtureReport(root, {
        targetPath: ".",
        topCount: 100,
        mode: "exploratory",
      });
      const finding = report.findings.find(
        (candidate) => candidate.ruleId === "prefer-workflow-dispatch-run-details",
      );
      expect(Boolean(finding)).toBe(expected);
      if (expected) {
        expect(finding?.suggestion).toContain("Node 24");
        expect(finding?.suggestion).toContain("run-id/run-url");
      }
    },
  );

  test("does not flag a release-like downstream job when its if condition explicitly allows optional upstream skip paths", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardOptionalSkipOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
  });

  test("does not flag failure-only release notification jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-release-guard-notify-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "nightly.yml"),
      [
        "name: nightly",
        "on:",
        "  schedule:",
        "    - cron: '0 0 * * *'",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  notify:",
        "    needs: build",
        "    if: failure()",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo notify",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "missing-release-downstream-success-guard",
      ),
    ).toBe(false);
  });

  test("adds repository precedent context to missing-release-downstream-success-guard", async () => {
    const fixtureRoot = await tempDirs.create("apl-release-guard-precedent-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });

    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "guarded.yml"),
      [
        "name: guarded",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  publish:",
        "    needs: build",
        "    if: always() && !failure() && !cancelled() && needs.build.result == 'success'",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo publish",
      ].join("\n"),
    );
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "unguarded.yml"),
      [
        "name: unguarded",
        "on:",
        "  push:",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo build",
        "  publish:",
        "    needs: build",
        "    if: always()",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: echo publish",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const finding = report.findings.find(
      (candidate) =>
        candidate.ruleId === "missing-release-downstream-success-guard" &&
        candidate.workflow === ".github/workflows/unguarded.yml",
    );

    expect(finding).toBeDefined();
    expect(finding?.why).toContain(
      "This repository already uses explicit downstream release success guards",
    );
    expect(finding?.why).toContain(".github/workflows/guarded.yml:publish");
  });

  test("does not flag reporting and upload downstream jobs using always()", async () => {
    const report = await getFixtureReport(fixtures.releaseGuardReportingOk, {
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (c) => c.ruleId === "missing-release-downstream-success-guard",
    );

    expect(findings.some((f) => f.message.includes('job "report-test-results-to-datadog"'))).toBe(
      false,
    );
    expect(findings.some((f) => f.message.includes('job "upload-adapter-results"'))).toBe(false);
    expect(findings.some((f) => f.message.includes('job "publish"'))).toBe(true);
  });

  test("keeps missing-timeout-minutes advisory when a heavy step already has its own timeout", async () => {
    const report = await getFixtureReport(fixtures.stepTimeoutOnlyLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "missing-timeout-minutes",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain("job-level timeout-minutes");
    expect(finding?.why).toContain("already times out at least one heavy step");
  });
});
