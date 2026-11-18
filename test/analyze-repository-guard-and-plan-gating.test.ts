import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };

async function findings(workflow: Record<string, unknown>, files: Record<string, string> = {}) {
  const root = await tempDirs.create("apl-guard-plan-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify(workflow),
    ...files,
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings;
}

describe("missing-release-downstream-success-guard", () => {
  // iyi's "result" job: always() + toJSON(needs) checked by an inline script.
  const scriptedVerdictJob = {
    needs: ["build", "test"],
    if: "${{ always() }}",
    "runs-on": "ubuntu-latest",
    steps: [
      {
        name: "Every selected job passed",
        env: { RESULTS: "${{ toJSON(needs) }}" },
        run: 'printf \'%s\' "$RESULTS" | python3 -c \'import json,sys; failed=[n for n,j in json.load(sys.stdin).items() if j["result"] in ("failure","cancelled")]; sys.exit(1 if failed else 0)\'',
      },
    ],
  };

  const upstreamJobs = {
    build: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "make build" }],
    },
    test: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "make test" }],
    },
  };

  const releaseLike = {
    name: "Release",
    on: { push: { tags: ["v*"] } },
    permissions: { contents: "write" },
  };

  test("a scripted toJSON(needs) verdict job is a guard, not a gap", async () => {
    const report = await findings({
      ...releaseLike,
      jobs: { ...upstreamJobs, result: scriptedVerdictJob },
    });
    expect(
      report.filter((finding) => finding.ruleId === "missing-release-downstream-success-guard"),
    ).toHaveLength(0);
  });

  test("an always() downstream without any guard still reports", async () => {
    const unguarded = {
      ...scriptedVerdictJob,
      steps: [{ run: "gh release upload v1 dist/*" }],
    };
    const report = await findings({
      ...releaseLike,
      jobs: { ...upstreamJobs, publish: unguarded },
    });
    const matches = report.filter(
      (finding) => finding.ruleId === "missing-release-downstream-success-guard",
    );
    expect(matches).toHaveLength(1);
  });

  test("a script that never references the needs context is not a guard", async () => {
    const noNeeds = {
      ...scriptedVerdictJob,
      steps: [
        {
          run: "python3 -c 'import sys; sys.exit(1 if \"failure\" else 0)'",
        },
      ],
    };
    const report = await findings({
      ...releaseLike,
      jobs: { ...upstreamJobs, result: noNeeds },
    });
    expect(
      report.filter((finding) => finding.ruleId === "missing-release-downstream-success-guard"),
    ).toHaveLength(1);
  });
});

describe("missing-paths-filter change-based job selection abstention", () => {
  const heavyJob = {
    "runs-on": "ubuntu-latest",
    steps: [{ run: "npm ci" }, { run: "npm test" }, { run: "npm run build" }],
  };

  const triggers = { push: { branches: ["main"] }, pull_request: null };

  function gatedJob(planOutput: string) {
    return {
      ...heavyJob,
      if: `\${{ contains(fromJSON(needs.plan.outputs.jobs), '${planOutput}') }}`,
    };
  }

  const planJob = {
    "runs-on": "ubuntu-latest",
    outputs: { jobs: "${{ steps.plan.outputs.jobs }}" },
    steps: [{ id: "plan", run: "python3 scripts/ci_plan.py" }],
  };

  test("a planner job gating most heavy jobs suppresses the trigger-filter advice", async () => {
    const report = await findings({
      name: "CI",
      on: triggers,
      jobs: {
        plan: planJob,
        static: gatedJob("static"),
        tests: gatedJob("tests"),
        build: gatedJob("build"),
        lint: gatedJob("lint"),
        package: gatedJob("package"),
      },
    });
    expect(report.filter((finding) => finding.ruleId === "missing-paths-filter")).toHaveLength(0);
  });

  test("dorny-style changes outputs count as change-based selection", async () => {
    const report = await findings({
      name: "CI",
      on: triggers,
      jobs: {
        changes: {
          "runs-on": "ubuntu-latest",
          outputs: { src: "${{ steps.filter.outputs.src }}" },
          steps: [{ uses: "dorny/paths-filter@v3", id: "filter" }],
        },
        build: { ...heavyJob, if: "${{ needs.changes.outputs.src == 'true' }}" },
        test: { ...heavyJob, if: "${{ needs.changes.outputs.src == 'true' }}" },
        lint: { ...heavyJob, if: "${{ needs.changes.outputs.src == 'true' }}" },
      },
    });
    expect(report.filter((finding) => finding.ruleId === "missing-paths-filter")).toHaveLength(0);
  });

  test("one or two conditional jobs do not suppress the advice", async () => {
    const report = await findings({
      name: "CI",
      on: triggers,
      jobs: {
        build: heavyJob,
        test: heavyJob,
        lint: heavyJob,
        deploy: {
          ...heavyJob,
          if: "${{ needs.build.outputs.ok == 'true' }}",
        },
      },
    });
    expect(report.filter((finding) => finding.ruleId === "missing-paths-filter").length).toBe(1);
  });
});
