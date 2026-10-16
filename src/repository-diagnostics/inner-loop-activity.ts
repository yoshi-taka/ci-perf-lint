import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { WorkflowJob } from "../workflow.ts";
import { completedWeekdays, createLocalDateKey } from "./inner-loop-calendar.ts";

const exec = promisify(execFile);
const DAY = 86_400_000;
const MIN_RUNS_PER_WEEKDAY = 20;
const MIN_ACTIVE_DAYS = 3;
const MIN_SETUP_SECONDS = 60;
const MAX_PAGES = 2;

interface ActivityJob {
  id: string;
  job: WorkflowJob;
}

export interface InnerLoopActivity {
  runsPerWeekday: number;
  activeDays: number;
  setupSeconds: number;
  samples: number;
  lowerBound: boolean;
  timeZone: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function timestamp(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function setupDuration(apiJob: Record<string, unknown>, job: WorkflowJob): number | undefined {
  if (
    apiJob.status !== "completed" ||
    apiJob.conclusion === "skipped" ||
    !Array.isArray(apiJob.steps)
  ) {
    return undefined;
  }
  let seconds = 0;
  for (const step of job.steps) {
    const isSetup =
      Boolean(step.uses) ||
      Boolean(
        step.run && /^(?:(?:npm|pnpm|yarn|bun) (?:ci|install)|uv sync)\b/.test(step.run.trim()),
      );
    if (!isSetup) {
      continue;
    }
    // Match unambiguous rendered names; never guess based on API array positions.
    const name = step.name ?? `Run ${step.uses ?? step.run?.split("\n")[0]}`;
    const matches = apiJob.steps.map(record).filter((entry) => entry?.name === name);
    if (matches.length !== 1) {
      return undefined;
    }
    const entry = matches[0]!;
    if (entry.status !== "completed" || entry.conclusion !== "success") {
      return undefined;
    }
    const duration = (timestamp(entry.completed_at) - timestamp(entry.started_at)) / 1000;
    if (!Number.isFinite(duration) || duration < 0) {
      return undefined;
    }
    seconds += duration;
  }
  return seconds;
}

async function sameRepository(root: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (!env.GITHUB_WORKSPACE || !env.GITHUB_REPOSITORY || !env.GITHUB_SERVER_URL) {
    return false;
  }
  if ((await realpath(root)) !== (await realpath(env.GITHUB_WORKSPACE))) {
    return false;
  }
  const { stdout } = await exec("git", ["-C", root, "config", "--get", "remote.origin.url"], {
    timeout: 1000,
    maxBuffer: 4096,
  });
  const server = new URL(env.GITHUB_SERVER_URL);
  const remote = stdout.trim();
  const url = remote.startsWith("git@")
    ? new URL(remote.replace(/^git@([^:]+):/, "ssh://git@$1/"))
    : new URL(remote);
  return (
    url.hostname === server.hostname &&
    url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .toLowerCase() === env.GITHUB_REPOSITORY.toLowerCase()
  );
}

/** Bounded, read-only telemetry. Missing/partial evidence suppresses this advisory rule. */
export async function collectInnerLoopActivity(
  root: string,
  candidates: ReadonlyMap<string, readonly ActivityJob[]>,
  options: {
    declaredVisibility?: "private" | "public";
    env?: NodeJS.ProcessEnv;
    request?: typeof fetch;
    now?: number;
  } = {},
): Promise<Map<string, InnerLoopActivity>> {
  const { declaredVisibility, env = process.env, request = fetch, now = Date.now() } = options;
  const result = new Map<string, InnerLoopActivity>();
  const token = [env.GH_TOKEN, env.GITHUB_TOKEN].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (
    declaredVisibility === "public" ||
    env.GITHUB_ACTIONS !== "true" ||
    !token ||
    candidates.size === 0
  ) {
    return result;
  }
  try {
    if (!(await sameRepository(root, env))) {
      return result;
    }
    const server = new URL(env.GITHUB_SERVER_URL!);
    const api = new URL(env.GITHUB_API_URL ?? "https://api.github.com");
    const expected =
      server.hostname === "github.com" ? "https://api.github.com" : `${server.origin}/api/v3`;
    // Do not send credentials to arbitrary API URLs or follow redirects.
    if (server.protocol !== "https:" || api.href.replace(/\/$/, "") !== expected) {
      return result;
    }
    const timeZone = env.TZ ?? "UTC";
    const localDate = createLocalDateKey(timeZone);
    const days = completedWeekdays(now, timeZone);
    const daySet = new Set(days);
    const since = new Date(Date.parse(`${days[0]}T00:00:00Z`) - DAY).toISOString();
    const signal = AbortSignal.timeout(10_000);
    let requests = 0;
    const get = async (endpoint: string): Promise<Record<string, unknown>> => {
      if (++requests > 4) {
        throw new Error("request budget exhausted");
      }
      const response = await request(`${expected}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        throw new Error("telemetry unavailable");
      }
      const value = record(await response.json());
      if (!value) {
        throw new Error("invalid telemetry");
      }
      return value;
    };
    const repoPath = `/repos/${env.GITHUB_REPOSITORY!.split("/").map(encodeURIComponent).join("/")}`;
    const repository = await get(repoPath);
    if (repository.private !== true || repository.full_name !== env.GITHUB_REPOSITORY) {
      return result;
    }
    let uniqueRuns: Record<string, unknown>[] = [];
    let complete = false;
    let retrieved = 0;
    const byId = new Map<unknown, Record<string, unknown>>();
    let runsPerWeekday = 0;
    let activeDays = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await get(
        `${repoPath}/actions/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(response.workflow_runs) || !Number.isInteger(response.total_count)) {
        return result;
      }
      const entries = response.workflow_runs.map(record);
      if (
        entries.some(
          (entry) =>
            !entry ||
            !Number.isSafeInteger(entry.id) ||
            !Number.isFinite(timestamp(entry.created_at)),
        )
      ) {
        return result;
      }
      retrieved += entries.length;
      for (const entry of entries) {
        if (
          entry &&
          ["push", "pull_request", "merge_group"].includes(String(entry.event)) &&
          daySet.has(localDate(timestamp(entry.created_at)))
        ) {
          byId.set(entry.id, entry);
        }
      }
      uniqueRuns = [...byId.values()];
      runsPerWeekday = uniqueRuns.length / 5;
      activeDays = new Set(uniqueRuns.map((run) => localDate(timestamp(run.created_at)))).size;
      complete = retrieved >= Number(response.total_count);
      const hasRepresentative = uniqueRuns.some(
        (run) =>
          run.status === "completed" && typeof run.path === "string" && candidates.has(run.path),
      );
      // Observed runs alone can prove a lower bound. No need to exhaust history.
      if (
        complete ||
        (runsPerWeekday >= MIN_RUNS_PER_WEEKDAY &&
          activeDays >= MIN_ACTIVE_DAYS &&
          hasRepresentative) ||
        entries.length === 0
      ) {
        break;
      }
    }
    if (runsPerWeekday < MIN_RUNS_PER_WEEKDAY || activeDays < MIN_ACTIVE_DAYS) {
      return result;
    }
    const run = uniqueRuns
      .filter(
        (entry) =>
          entry.status === "completed" &&
          typeof entry.path === "string" &&
          candidates.has(entry.path),
      )
      .sort(
        (a, b) => timestamp(b.created_at) - timestamp(a.created_at) || Number(b.id) - Number(a.id),
      )[0];
    if (!run) {
      return result;
    }
    const response = await get(
      `${repoPath}/actions/runs/${String(run.id)}/jobs?per_page=100&filter=latest`,
    );
    if (!Array.isArray(response.jobs) || response.total_count !== response.jobs.length) {
      return result;
    }
    // A single jobs response covers every candidate job in this representative workflow.
    for (const candidate of candidates.get(String(run.path)) ?? []) {
      const name = candidate.job.raw.name ?? candidate.job.id;
      const matches = response.jobs.map(record).filter((job) => job?.name === name);
      if (matches.length !== 1) {
        continue;
      }
      const duration = setupDuration(matches[0]!, candidate.job);
      if (duration === undefined) {
        continue;
      }
      if (duration >= MIN_SETUP_SECONDS) {
        result.set(candidate.id, {
          runsPerWeekday,
          activeDays,
          setupSeconds: duration,
          samples: 1,
          lowerBound: !complete,
          timeZone,
        });
      }
    }
  } catch {
    // Never report credentials, fail the audit, or turn unavailable data into a zero.
  }
  return result;
}
