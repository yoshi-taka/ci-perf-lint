import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const activityNow = Date.parse("2026-10-19T12:00:00Z");
export const activityDays = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

export function activityRuns(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    path: ".github/workflows/ci.yml",
    created_at: `${activityDays[index % 5]}T12:00:00Z`,
    event: "push",
    status: "completed",
  }));
}

export function activityApiJob(seconds = 60) {
  const start = "2026-10-16T12:00:00Z";
  return {
    name: "lint",
    status: "completed",
    conclusion: "success",
    steps: [
      "Run actions/checkout@v4",
      "Run oven-sh/setup-bun@v2",
      "Run bun install --frozen-lockfile",
    ].map((name, index) => ({
      name,
      status: "completed",
      conclusion: "success",
      started_at: start,
      completed_at: new Date(Date.parse(start) + (index === 2 ? seconds : 0) * 1000).toISOString(),
    })),
  };
}

export async function prepareActivityRepository(root: string) {
  // Minimal shallow Git repository: no full history or network needed.
  for (const directory of [".git/objects", ".git/refs/heads"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, ".git/HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    path.join(root, ".git/config"),
    '[core]\nrepositoryformatversion = 0\n[remote "origin"]\nurl = https://github.com/example/private.git\n',
  );
  await writeFile(path.join(root, ".git/shallow"), `${"a".repeat(40)}\n`);
}

export function activityEnvironment(root: string): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: "true",
    GH_TOKEN: "fixture-token",
    GITHUB_REPOSITORY: "example/private",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_WORKSPACE: root,
    TZ: "UTC",
  };
}
