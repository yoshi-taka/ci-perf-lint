import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };
const ruleId = "missing-fail-fast-cancellation";

const gateJob = {
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 10,
  steps: [{ uses: "actions/checkout@v7" }, { run: "npm ci" }, { run: "npm run lint" }],
};

const heavyLane = {
  "runs-on": "ubuntu-latest",
  steps: [
    { uses: "actions/checkout@v7" },
    { run: "npm ci" },
    { run: "npm test" },
    { run: "npm run build" },
  ],
};

const cancellationJob = {
  needs: "lint",
  if: "failure() && github.event_name == 'pull_request'",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 5,
  permissions: { actions: "write" },
  steps: [
    {
      name: "Cancel this pull request's remaining jobs",
      "continue-on-error": true,
      env: { GH_TOKEN: "${{ github.token }}" },
      run: 'gh run cancel "${GITHUB_RUN_ID}" --repo "${GITHUB_REPOSITORY}"',
    },
  ],
};

async function findings(
  jobs: Record<string, unknown>,
  on: Record<string, unknown> = { pull_request: null, push: { branches: ["main"] } },
) {
  const root = await tempDirs.create("apl-fail-fast-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify({ name: "CI", on, jobs }),
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe(ruleId, () => {
  test("flags a fast gate with uncancelled parallel heavy lanes", async () => {
    const matches = await findings({
      lint: gateJob,
      test: heavyLane,
      build: heavyLane,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("suggestion");
    expect(matches[0]?.message).toContain("Fast gate job lint");
    expect(matches[0]?.message).toContain("up to 2 lanes");
  });

  test("multiple gates consolidate into one finding", async () => {
    const matches = await findings({
      lint: gateJob,
      fmt: { ...gateJob, "timeout-minutes": 5 },
      test: heavyLane,
      build: heavyLane,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("Fast gate jobs lint, fmt");
  });

  test("fixture baseline fires and the cancelled fixture stays silent", async () => {
    const like = await getWorkflowFocusedFixtureReport(
      fixtures.missingFailFastCancellationLike,
      options,
    );
    expect(like.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(1);
    const ok = await getWorkflowFocusedFixtureReport(
      fixtures.missingFailFastCancellationOk,
      options,
    );
    expect(ok.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(0);
  });

  test("a failure-triggered needs job counts as the mechanism", async () => {
    expect(
      await findings({
        lint: gateJob,
        "stop-after-gate-failure": cancellationJob,
        test: heavyLane,
        build: heavyLane,
      }),
    ).toHaveLength(0);
  });

  test("lanes that need the gate are skipped automatically on failure", async () => {
    expect(
      await findings({
        lint: gateJob,
        test: { ...heavyLane, needs: "lint" },
        build: { ...heavyLane, needs: ["lint"] },
      }),
    ).toHaveLength(0);
  });

  test("transitive needs on the gate exempts deep lanes", async () => {
    expect(
      await findings({
        lint: gateJob,
        middle: { ...heavyLane, needs: "lint" },
        test: { ...heavyLane, needs: "middle" },
      }),
    ).toHaveLength(0);
  });

  test("lanes that declare long timeouts widen the gate beyond its own timeout", async () => {
    const longLane = { ...heavyLane, "timeout-minutes": 45 };
    const matches = await findings({
      lint: { ...gateJob, "timeout-minutes": undefined },
      test: longLane,
      build: longLane,
    });
    expect(matches).toHaveLength(1);
  });

  test("undeclared classic lint-parallel layouts stay silent", async () => {
    expect(
      await findings({
        lint: { "runs-on": "ubuntu-latest", steps: gateJob.steps },
        test: heavyLane,
        build: heavyLane,
      }),
    ).toHaveLength(0);
  });

  test("gates without a small timeout stay out of scope", async () => {
    expect(
      await findings({
        lint: { ...gateJob, "timeout-minutes": 30 },
        test: heavyLane,
        build: heavyLane,
      }),
    ).toHaveLength(0);
  });

  test("a single heavy lane is not flagged", async () => {
    expect(await findings({ lint: gateJob, test: heavyLane })).toHaveLength(0);
  });

  test("result-aggregation jobs are not gates", async () => {
    const matches = await findings({
      lint: gateJob,
      check: {
        needs: "test",
        if: "${{ always() }}",
        "runs-on": "ubuntu-latest",
        "timeout-minutes": 5,
        steps: [{ run: "node scripts/aggregate.mjs" }],
      },
      test: heavyLane,
      build: heavyLane,
    });
    // lint is still a gate, but the always() aggregation job must not be
    // counted as one.
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("Fast gate job lint");
    expect(matches[0]?.message).not.toContain("lint, check");
  });

  test("a gate that waits on heavy work is not early", async () => {
    expect(
      await findings({
        "check-suite": heavyLane,
        check: { ...gateJob, needs: "check-suite" },
        build: heavyLane,
        package: heavyLane,
      }),
    ).toHaveLength(0);
  });

  test.each([
    ["tag-only push", { push: { tags: ["v*"] }, pull_request: null }],
    ["pull_request-only", { pull_request: null }],
  ])("abstains without a branch consumer: %s", async (_name, on) => {
    expect(await findings({ lint: gateJob, test: heavyLane, build: heavyLane }, on)).toHaveLength(
      0,
    );
  });
});
