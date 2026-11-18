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
const ruleId = "ungated-pr-docker-gha-export";

async function findings(workflow: Record<string, unknown>) {
  const root = await tempDirs.create("apl-ungated-docker-");
  await writeRepositoryFiles(root, {
    ".github/workflows/docker.yml": stringify(workflow),
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

const buildPushStep = (cacheTo: string, extra: Record<string, unknown> = {}) => ({
  uses: "docker/build-push-action@v6",
  with: { context: ".", push: false, "cache-from": "type=gha", "cache-to": cacheTo, ...extra },
});

describe(ruleId, () => {
  test("flags a bare mode=max gha export on a pull_request workflow", async () => {
    const matches = await findings({
      name: "Docker",
      on: { pull_request: null, push: { branches: ["main"] } },
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [{ uses: "actions/checkout@v7" }, buildPushStep("type=gha,mode=max,scope=build")],
        },
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("suggestion");
    expect(matches[0]?.message).toContain("exports mode=max GitHub Actions cache layers");
  });

  test("fixture baseline fires and the guarded fixture stays silent", async () => {
    const like = await getWorkflowFocusedFixtureReport(
      fixtures.ungatedPrDockerGhaExportLike,
      options,
    );
    expect(like.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(1);
    const ok = await getWorkflowFocusedFixtureReport(fixtures.ungatedPrDockerGhaExportOk, options);
    expect(ok.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(0);
  });

  test("an expression whose fallback arm is max still fires (openmapx shape)", async () => {
    const matches = await findings({
      name: "Docker",
      on: { pull_request: null, push: { branches: ["main"] } },
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            buildPushStep(
              "type=gha,mode=${{ matrix.app == 'api' && 'min' || 'max' }},scope=${{ matrix.app }}",
            ),
          ],
        },
      },
    });
    expect(matches).toHaveLength(1);
  });

  test("a push-only cache-to expression is a guard (buffa shape)", async () => {
    expect(
      await findings({
        name: "Docker",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              buildPushStep("${{ github.event_name == 'push' && 'type=gha,mode=max' || '' }}"),
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("step-level push guards keep the export out of PR runs", async () => {
    expect(
      await findings({
        name: "Docker",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              {
                ...buildPushStep("type=gha,mode=max"),
                if: "github.event_name == 'push'",
              },
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test.each([
    ["tag-only push", { push: { tags: ["v*"] }, pull_request: null }],
    ["pull_request-only", { pull_request: null }],
  ])("abstains without a branch consumer: %s", async (_name, on) => {
    expect(
      await findings({
        name: "Docker",
        on,
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [buildPushStep("type=gha,mode=max")],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("registry backends and min exports stay out of scope", async () => {
    expect(
      await findings({
        name: "Docker",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              buildPushStep("type=gha,mode=min,scope=build"),
              buildPushStep("type=registry,ref=ghcr.io/org/cache:build,mode=max"),
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });
});
