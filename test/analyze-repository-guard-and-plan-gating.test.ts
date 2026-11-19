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

  test.each([
    [
      "full enumeration (lumia packages)",
      "${{ !cancelled() && needs.publish.result == 'success' && needs.linux.result == 'success' }}",
    ],
    [
      "partial enumeration with intentional optional upstreams (lumia publish)",
      "${{ !cancelled() && needs.macos.result == 'success' && needs.android.result == 'success' }}",
    ],
    [
      "mode-branched enumeration (agent-native publish-release)",
      "${{ !cancelled() && inputs.mode != 'stage' && needs.prepare.result == 'success' && (inputs.mode == 'publish' || (needs.build.result == 'success' && needs.bundle.result == 'success')) }}",
    ],
    [
      "single-need enumeration with !failure()",
      "${{ !failure() && needs.promote.result == 'success' }}",
    ],
  ])(
    "a !cancelled()/!failure() override with explicit needs-success enumeration is guarded: %s",
    async (_label, ifText) => {
      const report = await findings({
        ...releaseLike,
        jobs: {
          ...upstreamJobs,
          publish: {
            needs: ["build", "test"],
            if: ifText,
            "runs-on": "ubuntu-latest",
            steps: [{ run: "gh release upload v1 dist/*" }],
          },
        },
      });
      expect(
        report.filter((finding) => finding.ruleId === "missing-release-downstream-success-guard"),
      ).toHaveLength(0);
    },
  );

  test("a !cancelled() override without needs-success enumeration still reports", async () => {
    const report = await findings({
      ...releaseLike,
      jobs: {
        ...upstreamJobs,
        publish: {
          needs: ["build", "test"],
          if: "${{ !cancelled() && github.event_name == 'workflow_dispatch' }}",
          "runs-on": "ubuntu-latest",
          steps: [{ run: "gh release upload v1 dist/*" }],
        },
      },
    });
    expect(
      report.filter((finding) => finding.ruleId === "missing-release-downstream-success-guard"),
    ).toHaveLength(1);
  });

  test("a weaker != failure guard is not an explicit success enumeration", async () => {
    const report = await findings({
      ...releaseLike,
      jobs: {
        ...upstreamJobs,
        publish: {
          needs: ["build", "test"],
          if: "${{ !cancelled() && needs.build.result != 'failure' }}",
          "runs-on": "ubuntu-latest",
          steps: [{ run: "gh release upload v1 dist/*" }],
        },
      },
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

  test("a reusable-workflow call whose outputs gate the caller's jobs suppresses the advice", async () => {
    // handsontable's test.yml: `checks` uses ./.github/workflows/checks.yml and
    // 14 of 16 jobs gate on needs.checks.outputs.* (in job `if` or the `with`
    // inputs of further reusable calls).
    const report = await findings({
      name: "CI",
      on: triggers,
      jobs: {
        checks: {
          uses: "./.github/workflows/checks.yml",
          with: { "test-all": "${{ inputs.test-all || false }}" },
        },
        lint: {
          ...heavyJob,
          needs: "checks",
          if: "${{ needs.checks.outputs.run-all == 'true' || needs.checks.outputs.outside-ci == 'true' }}",
        },
        unit: {
          ...heavyJob,
          needs: "checks",
          if: "${{ needs.checks.outputs.run-all == 'true' || needs.checks.outputs.test-unit == 'true' }}",
        },
        e2e: {
          needs: "checks",
          if: "${{ needs.checks.outputs.run-all == 'true' || needs.checks.outputs.test-e2e == 'true' }}",
          uses: "./.github/workflows/e2e.yml",
          with: {
            "run-e2e": "${{ needs.checks.outputs.run-all == 'true' }}",
          },
        },
      },
    });
    expect(report.filter((finding) => finding.ruleId === "missing-paths-filter")).toHaveLength(0);
  });

  test("data-plumbing references are not change selection (cache keys)", async () => {
    // managarm's ci.yml: cache-generic outputs feed actions/cache keys and
    // checkout refs, not execution gates. The workflow still builds on every
    // PR, so the trigger-filter advice stays.
    const report = await findings({
      name: "CI",
      on: { push: null, pull_request: { types: ["opened", "synchronize"] } },
      jobs: {
        "cache-generic": {
          "runs-on": "ubuntu-latest",
          outputs: {
            "caching-key": "${{ steps.head.outputs.caching-key }}",
            "bootstrap-commit": "${{ steps.head.outputs.bootstrap-commit }}",
          },
          steps: [
            {
              id: "head",
              run: 'head="$(git ls-remote https://github.com/example/bootstrap.git refs/heads/master)"\necho "caching-key=$head" >> "$GITHUB_OUTPUT"',
            },
          ],
        },
        "cache-arch": {
          "runs-on": "ubuntu-latest",
          needs: "cache-generic",
          steps: [
            {
              uses: "actions/cache@v5",
              with: {
                key: "xbps-${{ matrix.arch }}-${{ needs.cache-generic.outputs.caching-key }}",
                path: "cache",
              },
            },
            { run: "make all" },
          ],
        },
        "lint-package": {
          "runs-on": "ubuntu-latest",
          needs: "cache-generic",
          steps: [
            {
              uses: "actions/cache@v5",
              with: { key: "rootfs-${{ needs.cache-generic.outputs.caching-key }}", path: "cache" },
            },
            { run: "make lint" },
          ],
        },
        "build-package": {
          "runs-on": "ubuntu-latest",
          needs: "cache-generic",
          steps: [
            {
              uses: "actions/checkout@v7",
              with: { ref: "${{ needs.cache-generic.outputs.bootstrap-commit }}" },
            },
            { run: "make build" },
          ],
        },
      },
    });
    expect(report.filter((finding) => finding.ruleId === "missing-paths-filter")).toHaveLength(1);
  });

  test("bare producer references forwarded as data do not gate (grafana version fan-out)", async () => {
    // grafana's release-build.yml: setup's version/grafana-commit outputs are
    // passed into reusable-build `with` inputs and env as bare references —
    // data for the builders, not change selection.
    const report = await findings({
      name: "CI",
      on: triggers,
      jobs: {
        setup: {
          "runs-on": "ubuntu-latest",
          outputs: { version: "${{ steps.out.outputs.version }}" },
          steps: [{ id: "out", run: 'echo "version=1.2.3" >> "$GITHUB_OUTPUT"' }],
        },
        "build-docker-linux": {
          needs: "setup",
          uses: "./.github/workflows/build-docker-variants.yml",
          with: { version: "${{ needs.setup.outputs.version }}", arch: "amd64" },
        },
        "build-docker-arm": {
          needs: "setup",
          uses: "./.github/workflows/build-docker-variants.yml",
          with: { version: "${{ needs.setup.outputs.version }}", arch: "arm64" },
        },
        "publish-targz": {
          "runs-on": "ubuntu-latest",
          needs: "setup",
          steps: [
            {
              run: "make publish VERSION=${{ needs.setup.outputs.version }}",
            },
          ],
        },
        "publish-deb": {
          "runs-on": "ubuntu-latest",
          needs: "setup",
          steps: [
            {
              env: { VERSION: "${{ needs.setup.outputs.version }}" },
              run: "make deb",
            },
          ],
        },
      },
    });
    const matches = report.filter((finding) => finding.ruleId === "missing-paths-filter");
    expect(matches).toHaveLength(1);
  });
});
