import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(steps: unknown[], name = "Artifacts") {
  const cwd = await tempDirs.create("apl-checkout-context-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name,
      on: "workflow_dispatch",
      jobs: { process: { "runs-on": "ubuntu-latest", steps } },
    }),
  });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    workflowOnly: true,
    topCount: 100,
  });
}

test.each([
  ["const { run } = require('./.github/scripts/prefetch'); await run();", false],
  ["const mod = await import('./.github/scripts/prefetch.mjs');", false],
  ["const mod = require(process.env.GITHUB_WORKSPACE + '/.github/scripts/prefetch');", false],
  ["await github.rest.issues.listForRepo(context.repo);", true],
] as const)("github-script repository access: %s", async (script, expected) => {
  const report = await scan([
    { uses: "actions/checkout@v4" },
    { uses: "actions/github-script@v9", with: { script } },
    { uses: "actions/upload-artifact@v4", with: { path: "/tmp/context" } },
  ]);
  expect(
    report.findings.some((f) => f.ruleId === "unnecessary-checkout-when-only-using-artifacts"),
  ).toBe(expected);
});

test("unresolved helper may consume checked-out agent config", async () => {
  const report = await scan([
    { uses: "actions/checkout@v4", with: { "sparse-checkout": ".github\n.agents" } },
    {
      run: 'bash "${RUNNER_TEMP}/gh-aw/actions/save_base_github_folders.sh"',
      env: { GH_AW_AGENT_FOLDERS: ".github .agents" },
    },
    { uses: "actions/upload-artifact@v4", with: { path: "/tmp/config" } },
  ]);
  expect(
    report.findings.some((f) => f.ruleId === "unnecessary-checkout-when-only-using-artifacts"),
  ).toBe(false);
});

test.each([undefined, 1, 0, 2000])(
  "blob:none needs visible historical blobs: depth=%s",
  async (depth) => {
    const report = await scan(
      [
        { uses: "actions/checkout@v4", with: depth === undefined ? {} : { "fetch-depth": depth } },
        {
          name: "Generate changelog",
          run: "git log --oneline",
        },
      ],
      "Generate changelog",
    );
    expect(
      report.findings.some((f) => f.ruleId === "consider-filter-blob-none-for-release-metadata"),
    ).toBe(depth === 0 || depth === 2000);
  },
);

test("a changelog label does not prove what an opaque github-script helper executes", async () => {
  const report = await scan(
    [
      { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
      {
        name: "Generate changelog",
        uses: "actions/github-script@v9",
        with: {
          script:
            "const generate = require('./.github/scripts/generate_changelog'); await generate();",
        },
      },
    ],
    "Generate changelog",
  );
  expect(
    report.findings.some((f) => f.ruleId === "consider-filter-blob-none-for-release-metadata"),
  ).toBe(false);
});

test.each([1, 2000])("explicit fetch must also transfer history: depth=%s", async (depth) => {
  const report = await scan(
    [
      { uses: "actions/checkout@v4" },
      {
        run: `git fetch origin main --depth=${depth}\ngit log --oneline`,
        name: "Generate changelog",
      },
    ],
    "Release notes",
  );
  expect(
    report.findings.some((f) => f.ruleId === "consider-filter-blob-none-for-release-metadata"),
  ).toBe(depth > 1);
});
