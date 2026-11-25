import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const id = "missing-dependency-cache";
const setup = { uses: "oven-sh/setup-bun@v2" };
const install = { run: "bun install --frozen-lockfile" };
const cache = {
  uses: "actions/cache@v5",
  with: { path: "~/.bun/install/cache", key: "bun-deps" },
};
const mixed = { push: { branches: ["main"], tags: ["v*"] }, pull_request: null };

async function scan(
  on: unknown = mixed,
  job: Record<string, unknown> = {},
  workflow: Record<string, unknown> = {},
  steps: readonly Record<string, unknown>[] = [setup, install],
) {
  const cwd = await tempDirs.create("apl-tagged-cache-");
  await writeRepositoryFiles(cwd, {
    "package.json": '{"name":"tagged-cache"}',
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on,
      ...workflow,
      jobs: { checks: { "runs-on": "ubuntu-24.04", ...job, steps } },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    { id, severity: "suggestion" },
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

test.each([
  mixed,
  { push: { branches: ["main"], tags: ["v*"] } },
  { push: { branches: ["main"], "tags-ignore": ["v*"] } },
  { push: { "branches-ignore": ["archive/**"], tags: ["v*"] } },
  { push: { tags: ["v*"] }, pull_request: null },
  { push: { tags: ["v*"] }, pull_request_target: null, pull_request: null },
])("tag filters do not hide ordinary branch/PR dependency installs: %j", async (on) => {
  const findings = await scan(on);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.suggestion).toContain("total job time");
  expect(findings[0]?.aiHandoff).not.toContain("permissions");
  expect(await scan(on, {}, {}, [setup, cache, install])).toHaveLength(0);
});

test.each([
  { push: { tags: ["v*"] } },
  { push: { "tags-ignore": ["experimental-*"] } },
  { push: { tags: ["v*"] }, workflow_dispatch: null },
  { push: { tags: ["v*"] }, schedule: [{ cron: "0 0 * * *" }] },
])("tag-only release exemptions are retained: %j", async (on) => {
  expect(await scan(on)).toHaveLength(0);
});

test.each(["Release", "Nightly", "Build & Publish to PyPI", "Deploy production"])(
  "independently release-named workflows retain their exemption: %s",
  async (name) => {
    expect(await scan(mixed, {}, { name })).toHaveLength(0);
  },
);

test.each([
  { name: "Publish packages" },
  { if: "startsWith(github.ref, 'refs/tags/')" },
  { if: "${{ inputs.run_checks }}" },
  { if: "github.event_name == 'pull_request'" },
  { if: false },
])("release names and unresolved conditional jobs remain exempt: %j", async (job) => {
  expect(await scan(mixed, job)).toHaveLength(0);
});

test.each([
  { run: "npm publish --access public" },
  { run: "pnpm publish" },
  { run: "bun publish" },
  { run: "npm run release" },
  { run: "./scripts/publish.sh" },
  { run: "python -m twine upload dist/*" },
  { run: "gh release create v1" },
  { run: "docker push example/app:latest" },
  { run: "docker buildx build --push ." },
  { uses: "softprops/action-gh-release@v2" },
  { uses: "pypa/gh-action-pypi-publish@release/v1" },
  { uses: "changesets/action@v1" },
  { uses: "docker/build-push-action@v6", with: { push: true } },
  { uses: "docker/build-push-action@v6", with: { push: "${{ inputs.publish }}" } },
])("publication in a generically named job is preserved: %j", async (publication) => {
  expect(await scan(mixed, {}, {}, [setup, install, publication])).toHaveLength(0);
});

test.each([
  { run: "echo 'npm publish --access public'" },
  { run: "printf '%s\\n' 'docker push example/app:latest'" },
  { run: "# gh release create v1" },
  { uses: "docker/build-push-action@v6", with: { push: false } },
  { uses: "CodSpeedHQ/action@v4", with: { run: "node ./dist/run.js" } },
])(
  "printed release examples and non-publishing actions do not restore the exemption: %j",
  async (step) => {
    expect(await scan(mixed, {}, {}, [setup, install, step])).toHaveLength(1);
  },
);

test.each(["none", "write-only", "${{ inputs.mode }}"])(
  "cache access policy is not loosened: %s",
  async (mode) => {
    expect(await scan(mixed, { "cache-mode": mode })).toHaveLength(0);
  },
);

test("a release job does not exempt a different validation job", async () => {
  const cwd = await tempDirs.create("apl-mixed-release-cache-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: mixed,
      jobs: {
        checks: { "runs-on": "ubuntu-latest", steps: [setup, install] },
        publish_packages: {
          "runs-on": "ubuntu-latest",
          if: "startsWith(github.ref, 'refs/tags/')",
          steps: [setup, install, { run: "bun publish" }],
        },
      },
    }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    { id, severity: "suggestion" },
  );
  const findings = report.findings.filter((finding) => finding.ruleId === id);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('"checks"');
});
