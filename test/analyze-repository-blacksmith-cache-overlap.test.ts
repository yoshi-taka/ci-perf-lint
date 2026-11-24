import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const id = "blacksmith-sticky-disk-cache-overlap";
const meta = { id, severity: "suggestion" } as const;
const checkout = { uses: "useblacksmith/checkout@v1" };
const node = { uses: "actions/setup-node@v7", with: { cache: "npm" } };
const disk = { uses: "useblacksmith/stickydisk@v1", with: { key: "npm", path: "~/.npm" } };
const archive = { uses: "actions/cache@v4", with: { key: "npm", path: "~/.npm" } };

async function scan(
  steps: readonly Record<string, unknown>[],
  job: Record<string, unknown> = {},
  files: Record<string, string> = {},
  mode: "strict" | "exploratory" = "exploratory",
) {
  const cwd = await tempDirs.create("apl-blacksmith-overlap-");
  await writeRepositoryFiles(cwd, {
    "package.json": '{"name":"example"}',
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: "push",
      jobs: { test: { "runs-on": "blacksmith-2vcpu-ubuntu-2404", ...job, steps } },
    }),
    ...files,
  });
  const options = { cwd, targetPath: ".", mode, topCount: 1000 };
  const report =
    mode === "strict"
      ? await analyzeRepository(options)
      : await analyzeRepositoryForRule(options, meta);
  return report.findings.filter((finding) => finding.ruleId === id);
}

test.each([
  [fixtures.blacksmithCacheOverlapLike, 1],
  [fixtures.blacksmithCacheOverlapOk, 0],
] as const)("Blacksmith cache fixtures: %s", async (cwd, count) => {
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    meta,
  );
  expect(report.findings.filter((finding) => finding.ruleId === id)).toHaveLength(count);
});

test("pi-plugins: explicit npm cache and Sticky Disk produce a review, not strict failure", async () => {
  const steps = [checkout, node, disk, { run: "npm ci --no-audit --no-fund" }];
  const findings = await scan(steps);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.severity).toBe("suggestion");
  expect(findings[0]?.suggestion).toContain("fallback");
  expect(findings[0]?.aiHandoff).toContain("Do not automatically remove or reorder");
  expect(findings[0]?.measurementHint).toContain("does not prove a speedup");
  expect(await scan(steps, {}, {}, "strict")).toHaveLength(0);
});

test.each(["~/.npm", "~//.npm/", "$HOME/.npm", "${HOME}/.npm"])(
  "literal home aliases match: %s",
  async (path) => {
    expect(await scan([checkout, node, { ...disk, with: { key: "deps", path } }])).toHaveLength(1);
  },
);

test("explicit archive paths work in either order and deduplicate per path", async () => {
  expect(await scan([checkout, archive, disk])).toHaveLength(1);
  expect(await scan([checkout, disk, archive, archive])).toHaveLength(1);
  expect(
    await scan([
      checkout,
      { ...archive, with: { key: "target", path: "registry\n./target/" } },
      { ...disk, with: { key: "target", path: "target" } },
    ]),
  ).toHaveLength(1);
});

test("multiple overlapping paths yield one diagnostic per job", async () => {
  const findings = await scan([
    checkout,
    { ...archive, with: { key: "build", path: "target\nregistry" } },
    { ...disk, with: { key: "target", path: "target" } },
    { ...disk, with: { key: "registry", path: "registry" } },
  ]);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('"target", "registry"');
});

test.each([
  { name: "non-Blacksmith runner", job: { "runs-on": "ubuntu-latest" } },
  { name: "Windows npm defaults", job: { "runs-on": "blacksmith-4vcpu-windows-2025" } },
  { name: "non-Linux mounting", job: { "runs-on": "blacksmith-4vcpu-macos-15" } },
  { name: "unknown runner", job: { "runs-on": "${{ inputs.runner }}" } },
  { name: "container", job: { container: "node:26" } },
  { name: "HOME override", job: { env: { HOME: "/custom" } } },
  { name: "npm cache override", job: { env: { NPM_CONFIG_CACHE: "/custom" } } },
  { name: "npm config location", job: { env: { npm_config_userconfig: "/custom" } } },
])("abstains for $name", async ({ job }) => {
  expect(await scan([checkout, node, disk], job)).toHaveLength(0);
});

test.each([
  { ...disk, if: "runner.os == 'Linux'" },
  { ...disk, if: false },
  { ...disk, with: { key: "", path: "~/.npm" } },
  { ...disk, with: { key: "npm", path: "/home/runner/.npm" } },
  { ...disk, with: { key: "npm", path: "node_modules" } },
  { ...disk, with: { key: "npm", path: "${{ steps.path.outputs.cache }}" } },
  { ...disk, with: { key: "npm", path: "~/.npm/../.npm" } },
  { ...disk, with: { key: "npm", path: "~/.npm/**" } },
])("does not guess unsupported disk evidence: %j", async (candidate) => {
  expect(await scan([checkout, node, candidate])).toHaveLength(0);
});

test.each([
  { ...node, if: "failure()" },
  { ...node, with: { cache: false } },
  { ...node, with: {} },
  { ...node, with: { cache: "pnpm" } },
  { ...node, uses: "actions/setup-node@v1" },
  { ...node, uses: "actions/setup-node@v2.0.0" },
  { ...node, uses: "actions/setup-node@unknown-pin" },
  { ...archive, if: "runner.os != 'Linux'" },
  { ...archive, uses: "actions/cache/restore@v4" },
  { ...archive, uses: "actions/cache/save@v4" },
  { ...archive, with: { key: "npm", path: "~/.npm/**" } },
])("preserves fallback and other archive strategies: %j", async (candidate) => {
  expect(await scan([checkout, candidate, disk])).toHaveLength(0);
});

test.each([
  { uses: "./.github/actions/prepare" },
  { run: 'echo "NPM_CONFIG_CACHE=/custom" >> "$GITHUB_ENV"' },
  { run: "./prepare.sh" },
  { run: "cd other" },
])("unknown preparation prevents path inference before or between caches: %j", async (step) => {
  expect(await scan([checkout, step, node, disk])).toHaveLength(0);
  expect(await scan([checkout, node, step, disk])).toHaveLength(0);
});

test("checkout between caches resets evidence", async () => {
  expect(await scan([checkout, node, checkout, disk])).toHaveLength(0);
});

test("npmrc suppresses default npm path, but not explicit matching archive paths", async () => {
  const files = { ".npmrc": "cache=/custom\n" };
  expect(await scan([checkout, node, disk], {}, files)).toHaveLength(0);
  expect(await scan([checkout, archive, disk], {}, files)).toHaveLength(1);
});

test("step environment overrides and separate job caches are not combined", async () => {
  expect(
    await scan([checkout, { ...node, env: { NPM_CONFIG_CACHE: "/custom" } }, disk]),
  ).toHaveLength(0);
  expect(await scan([checkout, node], {})).toHaveLength(0);
  expect(await scan([checkout, disk], {})).toHaveLength(0);
});
