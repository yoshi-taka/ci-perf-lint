import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ruleId = "ineffective-concurrency-group";
const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };
const unique = { group: "ci-${{ github.run_id }}", "cancel-in-progress": true };
const stable = {
  group: "${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}",
  "cancel-in-progress": true,
};

async function findings({
  concurrency = unique,
  jobConcurrency,
  secondJob,
  on = "pull_request",
  run = "pnpm install --frozen-lockfile\npnpm build\npnpm test",
  name = "CI",
  jobId = "test",
}: {
  concurrency?: unknown;
  jobConcurrency?: unknown;
  secondJob?: unknown;
  on?: unknown;
  run?: string;
  name?: string;
  jobId?: string;
} = {}) {
  const root = await tempDirs.create("apl-concurrency-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify({
      name,
      on,
      concurrency: concurrency ?? undefined,
      jobs: {
        [jobId]: {
          "runs-on": "ubuntu-latest",
          concurrency: jobConcurrency,
          steps: [{ run }],
        },
        ...(secondJob ? { second: secondJob } : {}),
      },
    }),
  });
  const report = await getWorkflowFocusedFixtureReport(root, options);
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe(ruleId, () => {
  test("registers the OpenZeppelin-style baseline and reports it in strict mode", async () => {
    const report = await getWorkflowFocusedFixtureReport(
      fixtures.ineffectiveConcurrencyGroupLike,
      options,
    );
    const matches = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.location).toMatchObject({
      path: ".github/workflows/ci.yml",
      line: 4,
    });
    expect(matches[0]?.severity).toBe("warning");
    const strict = await getWorkflowFocusedFixtureReport(fixtures.ineffectiveConcurrencyGroupLike, {
      ...options,
      mode: "strict",
    });
    const strictMatches = strict.findings.filter((finding) => finding.ruleId === ruleId);
    expect(strictMatches).toHaveLength(1);
    expect(strictMatches[0]?.severity).toBe("warning");
  });

  test.each([
    ["run ID", "${{ github.run_id }}"],
    ["run number", "${{ github.run_number }}"],
    ["case-insensitive context", "${{ GitHub.RUN_ID }}"],
    [
      "Tailscale/Ollama typo",
      "${{ github.workflow }}-$${{ github.pull_request.number || github.run_id }}",
    ],
    ["typo with run number", "${{ github.pull_request.number || github.run_number }}"],
  ])("detects %s", async (_name, group) => {
    expect(await findings({ concurrency: { ...unique, group } })).toHaveLength(1);
  });

  test.each([
    ["correct PR fallback", stable],
    ["head ref fallback", { ...unique, group: "${{ github.head_ref || github.run_id }}" }],
    ["event number fallback", { ...unique, group: "${{ github.event.number || github.run_id }}" }],
    ["ref fallback", { ...unique, group: "${{ github.ref || github.run_id }}" }],
    [
      "run attempt is not a run ID",
      { ...unique, group: "${{ github.ref }}-${{ github.run_attempt }}" },
    ],
    ["SHA grouping", { ...unique, group: "${{ github.sha }}" }],
    ["literal text", { ...unique, group: "github.run_id" }],
    ["quoted expression text", { ...unique, group: "${{ 'github.run_id' }}" }],
    ["unknown format call", { ...unique, group: "${{ format('ci-{0}', github.run_id) }}" }],
    ["unknown input", { ...unique, group: "${{ inputs.group }}" }],
    ["pending replacement/serialization", { ...unique, "cancel-in-progress": false }],
    ["omitted cancellation", { group: unique.group }],
    ["dynamic cancellation", { ...unique, "cancel-in-progress": "${{ inputs.cancel }}" }],
    ["string false", { ...unique, "cancel-in-progress": "false" }],
    ["no concurrency", undefined],
    ["scalar concurrency", "ci-${{ github.ref }}"],
    [
      "OpenMapX event-specific group",
      {
        group:
          "ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}",
        "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
      },
    ],
  ])("does not flag %s", async (_name, concurrency) => {
    // Explicit null represents absent concurrency without invoking the default.
    expect(await findings({ concurrency: concurrency ?? null })).toHaveLength(0);
  });

  test.each(["push", "workflow_dispatch", "schedule", { pull_request: { types: ["edited"] } }])(
    "excludes non-update trigger %j",
    async (on) => {
      expect(await findings({ on })).toHaveLength(0);
    },
  );

  test("accepts an explicit synchronize event", async () => {
    expect(await findings({ on: { pull_request: { types: ["synchronize"] } } })).toHaveLength(1);
  });

  test("excludes lightweight workflows", async () => {
    expect(await findings({ run: "echo hello", name: "Notice", jobId: "notice" })).toHaveLength(0);
  });

  test("detects an unprotected job group", async () => {
    const matches = await findings({ concurrency: null, jobConcurrency: unique });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain('Job "test"');
  });

  test("accepts an explicit constant true expression for cancellation", async () => {
    expect(
      await findings({
        concurrency: { ...unique, "cancel-in-progress": "${{ true }}" },
      }),
    ).toHaveLength(1);
  });

  test("does not treat quoted true as a boolean", async () => {
    expect(
      await findings({
        concurrency: { ...unique, "cancel-in-progress": "true" },
      }),
    ).toHaveLength(0);
  });

  test("keeps distinct unprotected job findings", async () => {
    const matches = await findings({
      concurrency: null,
      jobConcurrency: unique,
      secondJob: {
        "runs-on": "ubuntu-latest",
        concurrency: { ...unique, group: "build-${{ github.run_id }}-${{ matrix.os }}" },
        strategy: { matrix: { os: ["ubuntu-latest", "windows-latest"] } },
        steps: [{ run: "pnpm build" }],
      },
    });
    expect(matches).toHaveLength(2);
  });

  test("outer protection suppresses job-level run IDs", async () => {
    expect(await findings({ concurrency: stable, jobConcurrency: unique })).toHaveLength(0);
  });

  test("unknown outer protection suppresses job-level run IDs", async () => {
    expect(
      await findings({
        concurrency: { ...stable, group: "${{ inputs.group }}" },
        jobConcurrency: unique,
      }),
    ).toHaveLength(0);
  });

  test("job protection suppresses an outer run ID", async () => {
    expect(await findings({ jobConcurrency: stable })).toHaveLength(0);
  });

  test("one protected job does not hide an unprotected sibling", async () => {
    expect(
      await findings({
        jobConcurrency: stable,
        secondJob: { "runs-on": "ubuntu-latest", steps: [{ run: "pnpm test" }] },
      }),
    ).toHaveLength(1);
  });

  test("reports only once when both levels contain run IDs", async () => {
    expect(await findings({ jobConcurrency: unique })).toHaveLength(1);
  });
});
