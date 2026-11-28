import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

function workflow(steps: readonly Record<string, unknown>[]): string {
  return stringify({
    name: "Depot CI",
    on: "push",
    jobs: { build: { "runs-on": "depot-ubuntu-24.04", steps } },
  });
}

const mount = (extra: Record<string, unknown> = {}) => ({
  uses: "depot/cache-mount@v1",
  with: { name: "org-npm-cache", path: "~/.npm", ...extra },
});

const sha = "a".repeat(40);

async function findings(
  directory: ".depot" | ".github",
  steps: readonly Record<string, unknown>[],
  id: "missing-dependency-cache" | "missing-turbo-cache",
) {
  const cwd = await tempDirs.create("apl-depot-cache-mount-");
  await writeRepositoryFiles(cwd, {
    [`${directory}/workflows/ci.yml`]: workflow(steps),
    "package.json": JSON.stringify({ name: "example", devDependencies: { turbo: "2.5.0" } }),
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    { id, severity: "suggestion" },
  );
  return report.findings.filter((finding) => finding.ruleId === id);
}

test("depot/cache-mount before install is dependency cache evidence in Depot CI", async () => {
  expect(
    await findings(
      ".depot",
      [mount(), { uses: "actions/setup-node@v6" }, { run: "npm ci" }],
      "missing-dependency-cache",
    ),
  ).toHaveLength(0);
});

test("a SHA-pinned cache mount is dependency cache evidence in Depot CI", async () => {
  expect(
    await findings(
      ".depot",
      [
        { ...mount(), uses: `depot/cache-mount@${sha}` },
        { uses: "actions/setup-node@v6" },
        { run: "npm ci" },
      ],
      "missing-dependency-cache",
    ),
  ).toHaveLength(0);
});

test("the same YAML under .github/workflows still reports a missing dependency cache", async () => {
  expect(
    await findings(
      ".github",
      [mount(), { uses: "actions/setup-node@v6" }, { run: "npm ci" }],
      "missing-dependency-cache",
    ),
  ).toHaveLength(1);
});

test.each([
  {
    name: "after install",
    steps: [{ uses: "actions/setup-node@v6" }, { run: "npm ci" }, mount()],
  },
  {
    name: "with if",
    steps: [
      { ...mount(), if: "github.ref == 'refs/heads/main'" },
      { uses: "actions/setup-node@v6" },
      { run: "npm ci" },
    ],
  },
])("cache mount $name does not count", async ({ steps }) => {
  expect(await findings(".depot", steps, "missing-dependency-cache")).toHaveLength(1);
});

test("depot/cache-mount before Turbo tasks is local cache evidence in Depot CI", async () => {
  expect(
    await findings(
      ".depot",
      [{ ...mount(), with: { name: "turbo", path: ".turbo" } }, { run: "npx turbo run build" }],
      "missing-turbo-cache",
    ),
  ).toHaveLength(0);
});

test("the same Turbo YAML under .github/workflows still reports a missing cache", async () => {
  expect(
    await findings(
      ".github",
      [{ ...mount(), with: { name: "turbo", path: ".turbo" } }, { run: "npx turbo run build" }],
      "missing-turbo-cache",
    ),
  ).toHaveLength(1);
});

test("a Turbo mount after the task does not count", async () => {
  expect(
    await findings(
      ".depot",
      [{ run: "npx turbo run build" }, { ...mount(), with: { name: "turbo", path: ".turbo" } }],
      "missing-turbo-cache",
    ),
  ).toHaveLength(1);
});
