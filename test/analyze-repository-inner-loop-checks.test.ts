import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { parseArgs } from "../src/main.ts";
import type { Diagnostic } from "../src/types.ts";
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
const id = "prefer-inner-loop-checks";
const policy = "Before opening a PR, run `bun run lint` and `bun run test`.";
const skill =
  "---\nname: validate\ndescription: Validate changes\n---\nRun `bun run lint` and fix failures.";
const files = { "AGENTS.md": policy, ".agents/skills/validate/SKILL.md": skill };

async function scan(
  options: {
    visibility?: "private" | "public" | "unknown";
    files?: Record<string, string>;
    run?: string;
    extraSteps?: Record<string, unknown>[];
    scripts?: Record<string, string>;
    job?: Record<string, unknown>;
    api?: boolean;
    apiPrivate?: boolean;
    runs?: number;
    setupSeconds?: number;
    cli?: boolean;
  } = {},
) {
  const root = await tempDirs.create("apl-inner-loop-");
  const content = {
    ...files,
    "package.json": JSON.stringify({ scripts: options.scripts ?? { lint: "oxlint ." } }),
    ".github/workflows/ci.yml": stringify({
      name: "Checks",
      on: "pull_request",
      jobs: {
        lint: {
          "runs-on": "ubuntu-latest",
          ...options.job,
          steps: [
            { uses: "actions/checkout@v4" },
            { uses: "oven-sh/setup-bun@v2" },
            { run: "bun install --frozen-lockfile" },
            { run: options.run ?? "bun run lint" },
            ...(options.extraSteps ?? []),
          ],
        },
      },
    }),
    ...options.files,
  };
  for (const [file, text] of Object.entries(content)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  const visibility = options.visibility ?? "private";
  await prepareActivityRepository(root);
  const code = `
    Date.now = () => ${activityNow};
    globalThis.fetch = async (url) => {
      const value = String(url).includes('/actions/workflows/')
        ? { total_count: ${options.runs ?? 100}, workflow_runs: ${JSON.stringify(activityRuns(options.runs ?? 100))} }
        : String(url).includes('/jobs?')
          ? { total_count: 1, jobs: [${JSON.stringify(activityApiJob(options.setupSeconds))}] }
          : { private: ${options.apiPrivate ?? true}, full_name: 'example/private' };
      return Response.json(value);
    };
    const { analyzeRepositoryForRule } = await import(${JSON.stringify(`${import.meta.dir}/helpers.ts`)});
    ${
      options.cli
        ? `
      const { runCli } = await import(${JSON.stringify(`${import.meta.dir}/../src/main.ts`)});
      await runCli(['--format', 'json', '--findings-only'], ${JSON.stringify(root)}, { log: console.log, error: console.error });
    `
        : `
      const report = await analyzeRepositoryForRule(${JSON.stringify({ cwd: root, targetPath: ".", topCount: 100, repositoryVisibility: visibility === "unknown" ? undefined : visibility })}, { id: '${id}', severity: 'warning' });
      console.log(JSON.stringify(report.findings));
    `
    }
  `;
  // Isolate mocks and Actions variables from concurrently running test files.
  const child = Bun.spawn([process.execPath, "--eval", code], {
    env: {
      ...process.env,
      ...activityEnvironment(root),
      GH_TOKEN: options.api === false ? "" : "fixture-token",
      GITHUB_TOKEN: "",
      AGENT: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) {
    throw new Error(stderr);
  }
  const findings = JSON.parse(stdout) as Diagnostic[];
  return { root, findings: findings.filter((finding) => finding.ruleId === id) };
}

test("private agent validation policy plus skill flags lint as warning in strict mode", async () => {
  const { findings } = await scan();
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("warning");
  expect(findings[0]?.location.path).toBe(".github/workflows/ci.yml");
  expect(findings[0]?.message).toContain("AGENTS.md");
  expect(findings[0]?.message).toContain("SKILL.md");
  expect(findings[0]?.message).toContain("20.0 workflow runs/day");
  expect(findings[0]?.message).toContain("median 60s");
  expect((await scan({ cli: true })).findings).toHaveLength(1);
});

test("public declaration or API visibility suppresses warnings", async () => {
  expect((await scan({ visibility: "public" })).findings).toEqual([]);
  expect((await scan({ apiPrivate: false })).findings).toEqual([]);
});

test("API verifies unknown visibility even in a shallow checkout", async () => {
  expect((await scan({ visibility: "unknown" })).findings).toHaveLength(1);
});

test("low activity, fast setup, or missing token suppresses warnings", async () => {
  expect((await scan({ runs: 99 })).findings).toEqual([]);
  expect((await scan({ setupSeconds: 59 })).findings).toEqual([]);
  expect((await scan({ api: false })).findings).toEqual([]);
});

test.each([
  "npx prettier --check .",
  "cargo fmt --check",
  "uv run ruff check .",
  "bunx oxfmt --check .",
])("recognizes dedicated check: %s", async (run) => {
  expect((await scan({ run })).findings).toHaveLength(1);
});

test.each([
  { "AGENTS.md": "", ".husky/pre-commit": "bun run lint" },
  { ".agents/skills/validate/SKILL.md": "", ".husky/pre-commit": "bun run lint" },
  { "AGENTS.md": "Use AI to develop this project." },
  { "AGENTS.md": "<!-- Before PR run bun run lint -->" },
  { ".agents/skills/validate/SKILL.md": "An empty skill without commands." },
  {
    ".agents/skills/validate/SKILL.md": "",
    ".claude/settings.json": '{"permissions":{"allow":["Bash(bun run lint)"]}}',
  },
  { ".agents/skills/validate/SKILL.md": "", ".claude/settings.json": "invalid" },
] as Record<string, string>[])("weak evidence does not qualify: %j", async (extraFiles) => {
  expect((await scan({ files: extraFiles })).findings).toEqual([]);
});

test("Claude policy and actual agent hooks qualify without skills", async () => {
  expect(
    (
      await scan({
        files: {
          "AGENTS.md": "",
          "CLAUDE.md": policy,
          ".agents/skills/validate/SKILL.md": "",
          ".claude/settings.json": JSON.stringify({
            hooks: { Stop: [{ hooks: [{ type: "command", command: "bun run lint" }] }] },
          }),
        },
      })
    ).findings,
  ).toHaveLength(1);
});

test.each([
  "bun run test",
  "bun run lint && bun run test",
  "npx prettier $(build)",
  "echo lint",
  "./scripts/validate",
])("unknown/mixed commands excluded: %s", async (run) => {
  expect((await scan({ run })).findings).toEqual([]);
});

test("a lint-named script that builds is not a lint-only job", async () => {
  expect(
    (await scan({ scripts: { lint: "bun run build", build: "vite build" } })).findings,
  ).toEqual([]);
  expect((await scan({ scripts: { lint: "oxlint .", prelint: "vite build" } })).findings).toEqual(
    [],
  );
});

test("mixed jobs, publishing actions and different working directories excluded", async () => {
  expect((await scan({ extraSteps: [{ run: "bun run test" }] })).findings).toEqual([]);
  expect((await scan({ extraSteps: [{ uses: "actions/upload-artifact@v4" }] })).findings).toEqual(
    [],
  );
  expect(
    (await scan({ job: { defaults: { run: { "working-directory": "frontend" } } } })).findings,
  ).toEqual([]);
});

test("visibility CLI validates values, never assumes private", () => {
  expect(parseArgs([])?.repositoryVisibility).toBeUndefined();
  expect(parseArgs(["--assume-visibility", "public"])?.repositoryVisibility).toBe("public");
  expect(() => parseArgs(["--assume-visibility", "internal"])).toThrow();
  expect(() => parseArgs(["--assume-visibility"])).toThrow();
});
