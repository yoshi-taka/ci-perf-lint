import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { stringify } from "yaml";
import { collectInnerLoopActivity } from "../src/repository-diagnostics/inner-loop-activity.ts";
import { completedWeekdays } from "../src/repository-diagnostics/inner-loop-calendar.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { createTempDirTracker } from "./helpers.ts";
import {
  activityApiJob,
  activityEnvironment,
  activityNow,
  activityRuns,
  prepareActivityRepository,
} from "./inner-loop-api-fixture.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

test("completed weekdays skip weekends, today, and handle local date boundaries", () => {
  expect(completedWeekdays(activityNow, "UTC")).toEqual([
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
    "2026-10-16",
  ]);
  const now = Date.parse("2026-10-19T00:30:00Z");
  expect(completedWeekdays(now, "Asia/Tokyo").at(-1)).toBe("2026-10-16");
  expect(completedWeekdays(now, "America/Los_Angeles").at(-1)).toBe("2026-10-16");
  expect(completedWeekdays(Date.parse("2026-10-20T00:30:00Z"), "America/Los_Angeles").at(-1)).toBe(
    "2026-10-16",
  );
  expect(completedWeekdays(Date.parse("2026-10-20T00:30:00Z"), "Asia/Tokyo").at(-1)).toBe(
    "2026-10-19",
  );
});

test("calendar selection crosses DST and year boundaries", () => {
  expect(completedWeekdays(Date.parse("2026-03-09T12:00:00Z"), "America/New_York")).toEqual([
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
  ]);
  expect(completedWeekdays(Date.parse("2026-01-02T12:00:00Z"), "UTC")).toEqual([
    "2025-12-26",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
  ]);
});

async function scan(
  options: {
    env?: NodeJS.ProcessEnv;
    runs?: ReturnType<typeof activityRuns>;
    total?: number;
    private?: boolean;
    job?: Record<string, unknown>;
    status?: number;
    throw?: boolean;
    duplicateJob?: boolean;
    extraWorkflows?: number;
    extraJob?: boolean;
  } = {},
) {
  const root = await tempDirs.create("apl-activity-");
  await prepareActivityRepository(root);
  const workflow = parseWorkflow(
    path.join(root, ".github/workflows/ci.yml"),
    root,
    stringify({
      on: "push",
      jobs: {
        lint: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v4" },
            { uses: "oven-sh/setup-bun@v2" },
            { run: "bun install --frozen-lockfile" },
            { run: "bun run lint" },
          ],
        },
      },
    }),
  );
  const requests: URL[] = [];
  const runs = options.runs ?? activityRuns();
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
    if (options.throw) {
      throw new Error("offline");
    }
    if (options.status) {
      return new Response("unavailable", { status: options.status });
    }
    if (url.pathname.endsWith("/example/private")) {
      return Response.json({ full_name: "example/private", private: options.private ?? true });
    }
    if (url.pathname.endsWith("/actions/runs")) {
      const page = Number(url.searchParams.get("page"));
      return Response.json({
        total_count: options.total ?? runs.length,
        workflow_runs: runs.slice((page - 1) * 100, page * 100),
      });
    }
    const job = options.job ?? activityApiJob();
    const jobs = options.duplicateJob
      ? [job, job]
      : options.extraJob
        ? [job, { ...job, name: "format" }]
        : [job];
    return Response.json({ total_count: jobs.length, jobs });
  }) as typeof fetch;
  const candidates = new Map([[workflow.relativePath, [{ id: "lint", job: workflow.jobs[0]! }]]]);
  if (options.extraJob) {
    candidates
      .get(workflow.relativePath)!
      .push({ id: "format", job: { ...workflow.jobs[0]!, id: "format" } });
  }
  for (let i = 0; i < (options.extraWorkflows ?? 0); i++) {
    candidates.set(`.github/workflows/other-${i}.yml`, [
      { id: `other-${i}`, job: workflow.jobs[0]! },
    ]);
  }
  const results = await collectInnerLoopActivity(root, candidates, {
    env: { ...activityEnvironment(root), ...options.env },
    request,
    now: activityNow,
  });
  return { results, requests };
}

test("20/day and 60s setup boundaries pass with three API requests", async () => {
  const { results, requests } = await scan();
  expect(results.get("lint")).toMatchObject({
    runsPerWeekday: 20,
    activeDays: 5,
    setupSeconds: 60,
    samples: 1,
    lowerBound: false,
    timeZone: "UTC",
  });
  expect(requests).toHaveLength(3);
  expect(requests[1]?.pathname).toBe("/repos/example/private/actions/runs");
});

test("zero days remain in denominator and low activity avoids jobs requests", async () => {
  const { results, requests } = await scan({ runs: activityRuns(99) });
  expect(results.size).toBe(0);
  expect(requests).toHaveLength(2);
});

test("run timestamps use the requested timezone when excluding weekends", async () => {
  const runs = activityRuns().map((run) => ({
    ...run,
    created_at: run.created_at.replace("T12:", "T00:"),
  }));
  expect((await scan({ runs, env: { TZ: "Asia/Tokyo" } })).results.size).toBe(1);
  // Monday just after midnight UTC is still Sunday in California.
  expect((await scan({ runs, env: { TZ: "America/Los_Angeles" } })).results.size).toBe(0);
});

test("one-day burst is not sustained development", async () => {
  const runs = activityRuns().map((run) => ({ ...run, created_at: "2026-10-16T12:00:00Z" }));
  expect((await scan({ runs })).results.size).toBe(0);
});

test("weekends, current day, schedule and repeated IDs do not inflate activity", async () => {
  for (const extra of [
    { created_at: "2026-10-17T12:00:00Z" },
    { created_at: "2026-10-19T01:00:00Z" },
    { event: "schedule" },
    { id: 1 },
  ]) {
    const runs = activityRuns(99);
    runs.push({ ...activityRuns()[99]!, ...extra });
    expect((await scan({ runs })).results.size).toBe(0);
  }
});

test("sufficient observed activity stops pagination and is labeled a lower bound", async () => {
  const { results, requests } = await scan({ runs: activityRuns(140) });
  expect(results.get("lint")).toMatchObject({ runsPerWeekday: 20, lowerBound: true });
  expect(requests).toHaveLength(3);
});

test("high volume does not require exhausting pagination", async () => {
  const { results, requests } = await scan({ runs: activityRuns(600), total: 600 });
  expect(results.get("lint")).toMatchObject({ runsPerWeekday: 20, lowerBound: true });
  expect(requests).toHaveLength(3);
});

test("one additional history page is allowed, total requests never exceed four", async () => {
  const runs = activityRuns(200).map((run, index) =>
    index < 100 ? { ...run, event: "schedule" } : run,
  );
  const { results, requests } = await scan({ runs });
  expect(results.get("lint")).toMatchObject({ runsPerWeekday: 20, lowerBound: false });
  expect(requests).toHaveLength(4);
});

test("insufficient activity after two pages is skipped without more API calls", async () => {
  const runs = activityRuns(600).map((run) => ({ ...run, created_at: "2026-10-16T12:00:00Z" }));
  const { results, requests } = await scan({ runs });
  expect(results.size).toBe(0);
  expect(requests).toHaveLength(3);
});

test("all candidate workflows share repo activity and one representative jobs response", async () => {
  const { results, requests } = await scan({ extraWorkflows: 100, extraJob: true });
  expect([...results.keys()]).toEqual(["lint", "format"]);
  expect(requests).toHaveLength(3);
  expect(requests.filter((url) => url.pathname.endsWith("/jobs"))).toHaveLength(1);
});

test("no matching representative workflow does not fetch arbitrary jobs", async () => {
  const runs = activityRuns().map((run) => ({ ...run, path: ".github/workflows/unrelated.yml" }));
  const { results, requests } = await scan({ runs });
  expect(results.size).toBe(0);
  expect(requests).toHaveLength(2);
});

test.each([
  { GITHUB_ACTIONS: "false" },
  { GH_TOKEN: "", GITHUB_TOKEN: "" },
  { GITHUB_REPOSITORY: "example/other" },
  { GITHUB_WORKSPACE: "/does-not-exist" },
  { GITHUB_API_URL: "https://attacker.example" },
  { TZ: "Invalid/Timezone" },
])("missing or unsafe execution context does not contact API: %j", async (env) => {
  const { results, requests } = await scan({ env });
  expect(results.size).toBe(0);
  expect(requests).toHaveLength(0);
});

test.each([401, 403, 404, 429, 500])("HTTP %i skips without failing audit", async (status) => {
  expect((await scan({ status })).results.size).toBe(0);
});

test("public repo, network failure, quick setup and ambiguous jobs suppressed", async () => {
  expect((await scan({ private: false })).results.size).toBe(0);
  expect((await scan({ throw: true })).results.size).toBe(0);
  expect((await scan({ job: activityApiJob(59) })).results.size).toBe(0);
  expect((await scan({ duplicateJob: true })).results.size).toBe(0);
  expect((await scan({ job: { ...activityApiJob(), conclusion: "skipped" } })).results.size).toBe(
    0,
  );
});

test("ambiguous/missing/skipped setup steps and unknown job mapping are not guessed", async () => {
  const baseline = activityApiJob();
  for (const job of [
    { ...baseline, name: "different" },
    { ...baseline, steps: baseline.steps.slice(1) },
    { ...baseline, steps: [...baseline.steps, baseline.steps[0]] },
    { ...baseline, steps: baseline.steps.map((step) => ({ ...step, conclusion: "skipped" })) },
    { ...baseline, steps: baseline.steps.map((step) => ({ ...step, started_at: "invalid" })) },
  ]) {
    expect((await scan({ job })).results.size).toBe(0);
  }
});
