import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const dirs = createTempDirTracker();
afterEach(() => dirs.cleanup());
type Job = Record<string, unknown> & { steps: Record<string, unknown>[] };
function component(directory: string, extra: Record<string, unknown> = {}): Job {
  return {
    "runs-on": "ubuntu-latest",
    ...extra,
    steps: [
      { uses: "actions/checkout@v4" },
      { run: "npm ci\nnpm run build", "working-directory": directory },
    ],
  };
}

async function findings(jobs: Record<string, Job>, extra: Record<string, unknown> = {}) {
  const cwd = await dirs.create("apl-component-scope-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({ name: "CI", on: "pull_request", ...extra, jobs }),
  });
  const report = await getWorkflowFocusedFixtureReport(cwd, { targetPath: ".", topCount: 100 });
  expect(
    report.analysisWarnings.filter((warning) =>
      ["parser-error", "rule-error"].includes(warning.kind),
    ),
  ).toEqual([]);
  return report.findings.filter(
    (finding) => finding.ruleId === "prefer-dorny-paths-filter-for-scoped-jobs",
  );
}

test("requires path evidence, not frontend/backend names or task suffixes", async () => {
  const backend = component(".");
  backend.steps[1]!.run = "pnpm run test:api";
  const frontend = component(".");
  frontend.steps[1]!.run = "pnpm run test:web";
  expect(await findings({ backend, frontend })).toHaveLength(0);
});

test("distinct directories warn without any component words in job names", async () => {
  const matches = await findings({ a: component("apps/api"), b: component("apps/web") });
  expect(matches).toHaveLength(1);
  expect(matches[0]?.severity).toBe("warning");
  expect(matches[0]?.message).toContain('"a" (apps/api)');
  expect(matches[0]?.message).toContain('"b" (apps/web)');
  expect(matches[0]?.why).toContain("not proof of independent dependencies");
  expect(matches[0]?.suggestion).toContain("shared source, lockfiles");
});

test("Tailscale ios/android are targets over shared packages, not independent scopes", async () => {
  const ios = component("src");
  ios.steps[0]!.with = { path: "src" };
  ios.steps[1] = {
    run: "./tool/go build ./ipn/... ./ssh/tailssh ./wgengine/ ./types/... ./control/controlclient",
    "working-directory": "src",
    env: { GOOS: "ios", GOARCH: "arm64" },
  };
  const android = component("src");
  android.steps[0]!.with = { path: "src" };
  android.steps[1] = {
    run: "./tool/go install ./net/netns ./ipn/ipnlocal ./wgengine/magicsock ./wgengine/ ./tailcfg/",
    "working-directory": "src",
    env: { GOOS: "android", GOARCH: "arm64" },
  };
  expect(await findings({ ios, android })).toHaveLength(0);
});

test.each([
  ["identical directories", "apps/api", "apps/api"],
  ["subdirectories of the same component", "apps/api/src", "apps/api/tests"],
  ["ancestor directories", "frontend", "frontend/tests"],
  ["root-wide work", ".", "apps/api"],
  ["generic apps root", "apps", "apps/api"],
  ["dynamic directory", "${{ inputs.component }}", "apps/api"],
  ["escaping directory", "../frontend", "apps/api"],
  ["absolute directory", "/frontend", "apps/api"],
])("excludes %s", async (_name, first, second) => {
  expect(await findings({ first: component(first), second: component(second) })).toHaveLength(0);
});

test("scoped packages are separate components; subdirectories are not", async () => {
  expect(
    await findings({
      first: component("packages/@acme/api"),
      second: component("packages/@acme/web"),
    }),
  ).toHaveLength(1);
  expect(
    await findings({
      first: component("packages/@acme/api"),
      second: component("packages/@acme/api/tests"),
    }),
  ).toHaveLength(0);
});

test("checkout path is removed before comparing component directories", async () => {
  const first = component("first/apps/api");
  first.steps[0]!.with = { path: "first" };
  const second = component("second/apps/api");
  second.steps[0]!.with = { path: "second" };
  expect(await findings({ first, second })).toHaveLength(0);
  second.steps[1]!["working-directory"] = "second/apps/web";
  expect(await findings({ first, second })).toHaveLength(1);
});

test("effective job and workflow defaults supply real directory evidence", async () => {
  const first = component("ignored", { defaults: { run: { "working-directory": "apps/api" } } });
  delete first.steps[1]!["working-directory"];
  const second = component("ignored");
  delete second.steps[1]!["working-directory"];
  expect(
    await findings(
      { first, second },
      {
        defaults: { run: { "working-directory": "apps/web" } },
      },
    ),
  ).toHaveLength(1);
});

test("root-wide or mixed-component commands disqualify a job", async () => {
  for (const directory of [".", "apps/web"]) {
    const first = component("apps/api");
    first.steps.push({ run: "npm test", "working-directory": directory });
    expect(await findings({ first, second: component("apps/web") })).toHaveLength(0);
  }
});

test.each([
  "cd ../web && npm test",
  "pnpm --filter web test",
  "npm --prefix ../web test",
  "npm run build -- $TARGET",
  "bash <<'SH'\nnpm run build\nSH",
])("does not infer scope through unmodeled commands: %s", async (run) => {
  const first = component("apps/api");
  first.steps[1]!.run = run;
  expect(await findings({ first, second: component("apps/web") })).toHaveLength(0);
});

test("logs and commented build commands are not a scoped heavy workload", async () => {
  const first = component("apps/api");
  first.steps[1]!.run = "echo 'npm run build'\n# npm run build";
  expect(await findings({ first, second: component("apps/web") })).toHaveLength(0);
});

test("gates are action-brand-independent and only ungated scopes are counted", async () => {
  const first = component("apps/api", { if: "needs.changed.outputs.api == 'true'" });
  expect(await findings({ first, second: component("apps/web") })).toHaveLength(0);
});

test("does not report unrelated root jobs alongside the scoped pair", async () => {
  const matches = await findings({
    a: component("apps/api"),
    b: component("apps/web"),
    ios: component("."),
  });
  expect(matches).toHaveLength(1);
  expect(matches[0]?.message).not.toContain('"ios"');
});

test("unknown checkout trees and local actions do not establish scope", async () => {
  for (const kind of ["missing", "multiple", "external", "local"]) {
    const first = component("apps/api");
    if (kind === "missing") {
      first.steps.shift();
    }
    if (kind === "multiple") {
      first.steps.unshift({ uses: "actions/checkout@v4" });
    }
    if (kind === "external") {
      first.steps[0]!.with = { repository: "other/repo" };
    }
    if (kind === "local") {
      first.steps.push({ uses: "./.github/actions/build-all" });
    }
    expect(await findings({ first, second: component("apps/web") })).toHaveLength(0);
  }
});
