import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const dirs = createTempDirTracker();
afterEach(() => dirs.cleanup());
type Step = Record<string, unknown>;
const checkout = (inputs: Record<string, unknown> = {}): Step => ({
  uses: "actions/checkout@v4",
  with: inputs,
});
const setup = (inputs: Record<string, unknown> = {}, version = "v5"): Step => ({
  uses: `actions/setup-go@${version}`,
  with: { "go-version": "1.22", ...inputs },
});
const manual = (extra: Record<string, unknown> = {}): Step => ({
  uses: "actions/cache@v4",
  with: {
    path: "~/go/pkg/mod\n~/.cache/go-build",
    key: "${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}",
  },
  ...extra,
});

async function findings(steps: Step[]) {
  const cwd = await dirs.create("apl-cache-readiness-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "CI",
      on: "pull_request",
      jobs: { test: { "runs-on": "ubuntu-latest", steps } },
    }),
    "go.mod": "module example.com/test\n\ngo 1.22\n",
    "go.sum": "example.com/dep v1.0.0 h1:example\n",
  });
  const report = await getWorkflowFocusedFixtureReport(cwd, { targetPath: ".", topCount: 100 });
  expect(
    report.analysisWarnings.filter((warning) =>
      ["parser-error", "rule-error"].includes(warning.kind),
    ),
  ).toEqual([]);
  return report.findings.filter(
    (finding) => finding.ruleId === "redundant-manual-cache-with-setup-action",
  );
}

test("multierr setup-before-checkout is not redundant, despite later matching manual cache", async () => {
  expect(
    await findings([
      setup({ "go-version": "${{ matrix.go }}" }),
      checkout(),
      manual(),
      { run: "go mod download" },
      { run: "make cover" },
    ]),
  ).toHaveLength(0);
});

test.each([
  ["default go cache", [checkout(), setup(), manual()]],
  ["explicit cache", [checkout(), setup({ cache: true }), manual()]],
  ["v3 opt-in", [checkout(), setup({ cache: "true" }, "v3"), manual()]],
  [
    "literal nested dependency file",
    [checkout({ path: "source" }), setup({ "cache-dependency-path": "source/go.sum" }), manual()],
  ],
  [
    "nested dependency glob",
    [
      checkout({ path: "source" }),
      setup({ "cache-dependency-path": "source/**/go.sum" }),
      manual(),
    ],
  ],
  [
    "multiple dependency files",
    [
      checkout({ path: "source" }),
      setup({ "cache-dependency-path": "source/a/go.sum\nsource/b/go.sum" }),
      manual(),
    ],
  ],
  ["manual first after checkout", [checkout(), manual(), setup()]],
  ["manual restore", [checkout(), setup(), manual({ uses: "actions/cache/restore@v4" })]],
  ["manual save", [checkout(), setup(), manual({ uses: "actions/cache/save@v4" })]],
  ["trivial setup condition", [checkout(), { ...setup(), if: "${{ true }}" }, manual()]],
] satisfies [string, Step[]][])("retains warning: %s", async (_name, steps) => {
  const matches = await findings(steps);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.severity).toBe("warning");
  expect(matches[0]?.message).toContain("after checkout");
});

test.each([
  ["no checkout", [setup(), manual()]],
  ["disabled boolean", [checkout(), setup({ cache: false }), manual()]],
  ["disabled string", [checkout(), setup({ cache: "false" }), manual()]],
  ["dynamic cache", [checkout(), setup({ cache: "${{ inputs.cache }}" }), manual()]],
  ["v3 default", [checkout(), setup({}, "v3"), manual()]],
  ["v2 does not support cache", [checkout(), setup({ cache: true }, "v2"), manual()]],
  ["unknown ref default", [checkout(), setup({}, "main"), manual()]],
  ["conditional checkout", [{ ...checkout(), if: "inputs.checkout" }, setup(), manual()]],
  ["checkout allowed to fail", [{ ...checkout(), "continue-on-error": true }, setup(), manual()]],
  ["false checkout", [{ ...checkout(), if: false }, setup(), manual()]],
  ["conditional setup", [checkout(), { ...setup(), if: "inputs.setup" }, manual()]],
  ["conditional manual", [checkout(), setup(), manual({ if: "inputs.manual" })]],
  ["nested checkout with default discovery", [checkout({ path: "source" }), setup(), manual()]],
  [
    "go-version-file does not relocate cache discovery",
    [checkout({ path: "source" }), setup({ "go-version-file": "source/go.mod" }), manual()],
  ],
  [
    "unrelated explicit path",
    [checkout({ path: "source" }), setup({ "cache-dependency-path": "other/go.sum" }), manual()],
  ],
  [
    "partial path prefix",
    [
      checkout({ path: "source" }),
      setup({ "cache-dependency-path": "source-other/go.sum" }),
      manual(),
    ],
  ],
  [
    "partly unknown dependency files",
    [
      checkout({ path: "source" }),
      setup({ "cache-dependency-path": "source/go.sum\nother/go.sum" }),
      manual(),
    ],
  ],
  [
    "dynamic dependency path",
    [checkout(), setup({ "cache-dependency-path": "${{ inputs.path }}" }), manual()],
  ],
  [
    "absolute dependency path",
    [checkout(), setup({ "cache-dependency-path": "/other/go.sum" }), manual()],
  ],
  [
    "escaping dependency path",
    [checkout(), setup({ "cache-dependency-path": "../go.sum" }), manual()],
  ],
  ["empty dependency path", [checkout(), setup({ "cache-dependency-path": "" }), manual()]],
  ["dynamic checkout path", [checkout({ path: "${{ inputs.path }}" }), setup(), manual()]],
  ["sparse checkout", [checkout({ "sparse-checkout": "src" }), setup(), manual()]],
  ["home dependency path", [checkout(), setup({ "cache-dependency-path": "~/go.sum" }), manual()]],
  [
    "Windows absolute path",
    [checkout(), setup({ "cache-dependency-path": "C:/go.sum" }), manual()],
  ],
  ["manual before source checkout", [manual(), checkout(), setup()]],
  ["multiple checkouts", [checkout(), checkout({ path: "other" }), setup(), manual()]],
  [
    "checkout changes after setup",
    [checkout(), setup(), checkout({ repository: "other/repo" }), manual()],
  ],
  ["checkout changes after manual", [checkout(), manual(), checkout(), setup()]],
  ["prior source mutation", [checkout(), { run: "rm go.sum" }, setup(), manual()]],
  ["opaque preparation", [checkout(), { uses: "./.github/actions/prepare" }, setup(), manual()]],
] satisfies [string, Step[]][])("abstains: %s", async (_name, steps) => {
  expect(await findings(steps)).toHaveLength(0);
});

test.each([
  ["node", "npm", "~/.npm"],
  ["python", "pip", "~/.cache/pip"],
  ["java", "maven", "~/.m2/repository"],
  ["dotnet", true, "~/.nuget/packages"],
])("checkout order also gates setup-%s", async (action, cache, cachePath) => {
  const runtime = { uses: `actions/setup-${action}@v4`, with: { cache } };
  const cacheStep = { uses: "actions/cache@v4", with: { path: cachePath, key: "dependencies" } };
  expect(await findings([runtime, checkout(), cacheStep])).toHaveLength(0);
  expect(await findings([checkout(), runtime, cacheStep])).toHaveLength(1);
});

test("ruby uses its own working-directory, not run defaults", async () => {
  const ruby = (directory: string) => ({
    uses: "ruby/setup-ruby@v1",
    with: { "bundler-cache": true, "working-directory": directory },
  });
  const cache = { uses: "actions/cache@v4", with: { path: "vendor/bundle", key: "bundler" } };
  expect(await findings([checkout({ path: "app" }), ruby("app"), cache])).toHaveLength(1);
  expect(await findings([checkout({ path: "app" }), ruby("."), cache])).toHaveLength(0);
  const ignoredInput = ruby(".");
  Object.assign(ignoredInput.with, { "cache-dependency-path": "app/Gemfile.lock" });
  expect(await findings([checkout({ path: "app" }), ignoredInput, cache])).toHaveLength(0);
});
