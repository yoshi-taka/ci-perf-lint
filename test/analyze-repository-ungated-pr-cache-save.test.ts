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
const ruleId = "ungated-pr-cache-save";

async function findings(workflow: Record<string, unknown>) {
  const root = await tempDirs.create("apl-ungated-cache-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify(workflow),
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

const buildSteps = [
  { uses: "actions/checkout@v7" },
  {
    uses: "actions/cache@v5",
    with: {
      path: ".turbo/cache",
      key: "turbo-build-${{ runner.os }}-${{ github.sha }}",
      "restore-keys": "turbo-build-${{ runner.os }}-\n",
    },
  },
  { run: "pnpm install --frozen-lockfile" },
  { run: "pnpm build" },
];

describe(ruleId, () => {
  test("flags a commit-pinned unguarded save on a pull_request workflow", async () => {
    const matches = await findings({
      name: "CI",
      on: { pull_request: null, push: { branches: ["main"] } },
      jobs: { build: { "runs-on": "ubuntu-latest", steps: buildSteps } },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("saves Actions caches from pull_request runs");
  });

  test("fixture baseline fires and the gated fixture stays silent", async () => {
    const like = await getWorkflowFocusedFixtureReport(fixtures.ungatedPrCacheSaveLike, options);
    expect(like.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(1);
    const ok = await getWorkflowFocusedFixtureReport(fixtures.ungatedPrCacheSaveOk, options);
    expect(ok.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(0);
  });

  test.each([
    ["tag-only push has no branch consumer", { push: { tags: ["v*"] }, pull_request: null }],
    ["pull_request-only workflow", { pull_request: null }],
  ])("abstains for a %s", async (_name, on) => {
    expect(
      await findings({
        name: "CI",
        on,
        jobs: { build: { "runs-on": "ubuntu-latest", steps: buildSteps } },
      }),
    ).toHaveLength(0);
  });

  test("merge-group saves are dead regardless of the key", async () => {
    const matches = await findings({
      name: "CI",
      on: {
        merge_group: { types: ["checks_requested"] },
        pull_request: null,
        push: { branches: ["main"] },
      },
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v7" },
            {
              uses: "actions/cache@v5",
              with: { path: ".turbo/cache", key: "turbo-${{ hashFiles('pnpm-lock.yaml') }}" },
            },
          ],
        },
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("merge-queue runs");
  });

  test.each([
    ["a push-gated save step", "github.ref == 'refs/heads/main' && github.event_name == 'push'"],
    ["an event-inequality guard", "github.event_name != 'pull_request'"],
  ])("does not flag %s", async (_name, stepIf) => {
    expect(
      await findings({
        name: "CI",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/checkout@v7" },
              {
                uses: "actions/cache/save@v5",
                if: stepIf,
                with: { path: ".turbo/cache", key: "turbo-${{ github.sha }}" },
              },
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("hashFiles keys and restore-only steps stay silent", async () => {
    expect(
      await findings({
        name: "CI",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/checkout@v7" },
              {
                uses: "actions/cache@v5",
                with: { path: "~/.pnpm-store", key: "pnpm-${{ hashFiles('pnpm-lock.yaml') }}" },
              },
              {
                uses: "actions/cache/restore@v5",
                with: { path: ".turbo/cache", key: "turbo-${{ github.sha }}" },
              },
            ],
          },
        },
      }),
    ).toHaveLength(0);
  });

  test("cache-mode write policy abstains", async () => {
    expect(
      await findings({
        name: "CI",
        on: { pull_request: null, push: { branches: ["main"] } },
        "cache-mode": "read",
        jobs: { build: { "runs-on": "ubuntu-latest", steps: buildSteps } },
      }),
    ).toHaveLength(0);
  });

  test("a job-level push guard keeps the save out of pull_request runs", async () => {
    expect(
      await findings({
        name: "CI",
        on: { pull_request: null, push: { branches: ["main"] } },
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            if: "github.event_name == 'push'",
            steps: buildSteps,
          },
        },
      }),
    ).toHaveLength(0);
  });
});
