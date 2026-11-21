import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import type { Diagnostic } from "../src/types.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const dirs = createTempDirTracker();
afterEach(() => dirs.cleanup());

function source(on: unknown, job: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return stringify({
    name: "CI",
    on,
    ...extra,
    jobs: { build: { "runs-on": "ubuntu-latest", ...job } },
  });
}

async function findings(workflow: string, extraFiles: Record<string, string> = {}) {
  const cwd = await dirs.create("apl-concurrency-safety-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": workflow,
    ...extraFiles,
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 1000,
    mode: "strict",
  });
  expect(
    report.analysisWarnings.filter((warning) =>
      ["parser-error", "rule-error", "collector-error"].includes(warning.kind),
    ),
  ).toEqual([]);
  return report.findings.filter((finding) => finding.ruleId === "missing-concurrency");
}

function expectSafeAdvice(finding: Diagnostic | undefined) {
  expect(finding).toBeDefined();
  expect(finding?.severity).toBe("warning");
  expect(finding?.suggestion).toContain("read-only PR/branch checks only");
  expect(finding?.suggestion).toContain("preferably at job level");
  expect(finding?.suggestion).toContain("Do not cancel release/publish/deploy work");
  expect(finding?.suggestion).toContain("cancel-in-progress: false with queue: max");
  expect(finding?.suggestion).toContain("100 pending");
  expect(finding?.suggestion).toContain("not a lossless release queue");
  expect(finding?.measurementHint).toContain("queued-release retention");
  expect(finding?.aiHandoff).toContain("Default concurrency replaces pending runs");
  expect(finding?.aiHandoff).toContain("does not guarantee dispatch order");
  expect(finding?.aiHandoff).toContain("Use a durable queue if every release must run");
  expect(finding?.suggestion).not.toContain("Add concurrency with cancel-in-progress");
}

test.each([
  ["read-only PR CI", "pull_request", { steps: [{ run: "npm ci\nnpm test" }] }],
  [
    "Astro-style branch release",
    { push: { branches: ["main", "next"] } },
    {
      steps: [
        { uses: "actions/checkout@v4" },
        { run: "pnpm install --frozen-lockfile\npnpm run build" },
        { uses: "changesets/action@v1", with: { publish: "pnpm release" } },
      ],
    },
  ],
  [
    "mixed PR/push publication",
    ["push", "pull_request"],
    {
      steps: [{ run: "npm run build\nnpm publish" }],
    },
  ],
  [
    "deployment",
    "push",
    {
      environment: "production",
      steps: [{ run: "npm run build\nterraform apply -auto-approve" }],
    },
  ],
  [
    "container push",
    "push",
    {
      steps: [{ uses: "docker/build-push-action@v6", with: { push: true } }],
    },
  ],
  [
    "opaque package script",
    "pull_request",
    {
      steps: [{ run: "npm run build\nnpm run ship" }],
    },
  ],
  [
    "reusable publication",
    ["push", "pull_request"],
    {
      uses: "example/repo/.github/workflows/publish.yml@main",
      "runs-on": undefined,
    },
  ],
  [
    "agentic PR workflow",
    "pull_request",
    {
      steps: [{ run: "npm ci" }, { uses: "anthropics/claude-code-action@v1" }],
    },
  ],
] satisfies [string, unknown, Record<string, unknown>][])(
  "safe conditional guidance even for %s",
  async (_name, on, job) => {
    const matches = await findings(source(on, job));
    expect(matches).toHaveLength(1);
    expectSafeAdvice(matches[0]);
  },
);

test("repository precedents, consensus and restacks cannot override publication safety", async () => {
  const job = { steps: [{ run: "npm ci\nnpm run build\nnpm publish" }] };
  const peer = source("pull_request", job, {
    concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true },
  });
  const matches = await findings(source("pull_request", job), {
    ".github/workflows/peer-a.yml": peer,
    ".github/workflows/peer-b.yml": peer,
    ".github/workflows/peer-c.yml": peer,
    ".graphite/config.json": "{}",
  });
  expect(matches).toHaveLength(1);
  const match = matches[0];
  expectSafeAdvice(match);
  expect(match?.why).toContain("similar workflows already use concurrency");
  expect(match?.why).toContain("Graphite/stacked diff");
  expect(match?.aiHandoff).toContain("never copy latest-only CI cancellation onto publication");
  expect(match?.aiHandoff).toContain("For superseded read-only PR validation only");
});

test.each([
  ["tag-only release", { push: { tags: ["v*"] } }],
  ["scheduled release", { schedule: [{ cron: "0 0 * * *" }] }],
  ["manual release", "workflow_dispatch"],
])("retains existing exclusion for %s", async (_name, on) => {
  expect(
    await findings(source(on, { steps: [{ run: "npm run build\nnpm publish" }] })),
  ).toHaveLength(0);
});

test.each([
  { concurrency: { group: "publish", "cancel-in-progress": false } },
  { concurrency: { group: "publish", queue: "max" } },
])("existing job concurrency stays out of missing-setting advice: %j", async (concurrency) => {
  expect(
    await findings(
      source("push", {
        ...concurrency,
        steps: [{ run: "npm run build\nnpm publish" }],
      }),
    ),
  ).toHaveLength(0);
});
