import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const sparseId = "prefer-sparse-checkout-for-scoped-workflow";
const blobId = "consider-filter-blob-none-for-release-metadata";
function workflow(steps: Record<string, unknown>[], name = "Release") {
  return { name, on: "push", jobs: { verify: { "runs-on": "ubuntu-latest", steps } } };
}
async function scan(
  configs: Record<string, unknown>,
  files: Record<string, string> = {},
  full = false,
) {
  const cwd = await tempDirs.create("apl-residual-context-");
  await writeRepositoryFiles(cwd, {
    ...files,
    ...Object.fromEntries(
      Object.entries(configs).map(([name, config]) => [
        `.github/workflows/${name}.yml`,
        stringify(config),
      ]),
    ),
  });
  return analyzeRepository({
    cwd,
    targetPath: ".",
    workflowOnly: !full,
    repositoryVisibility: "public",
    mode: "exploratory",
    topCount: 1000,
  });
}

test.each([
  "echo audit",
  "echo 'triage issue'",
  "# triage issue\necho audit",
  "grep 'pull request' notes.txt",
  "echo '$(danger ci)'",
])("meta data cannot skip real path/lint findings: %s", async (run) => {
  const report = await scan({
    ci: {
      name: "CI",
      on: "pull_request",
      jobs: {
        a: {
          "runs-on": "ubuntu-latest",
          steps: [{ run: "npm ci" }, { run: "npx eslint ." }, { run }],
        },
        b: { "runs-on": "ubuntu-latest", steps: [{ run: "npm ci" }, { run: "npx eslint ." }] },
      },
    },
  });
  for (const ruleId of [
    "missing-paths-filter",
    "missing-path-ignore-for-non-code",
    "duplicate-install-or-lint",
  ]) {
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(true);
  }
});

test.each([{ run: "danger ci" }, { uses: "actions/labeler@v5" }])(
  "real meta commands/actions retain skip intent: %j",
  async (step) => {
    const report = await scan({ ci: workflow([{ run: "npm ci" }, step], "CI") });
    expect(report.findings.some((f) => f.ruleId === "missing-paths-filter")).toBe(false);
  },
);

test.each(["echo audit", "echo 'git log'", "# git log\necho audit", "echo 'release notes'"])(
  "displayed history does not strengthen sparse explanation: %s",
  async (run) => {
    const report = await scan({
      ci: workflow([
        { uses: "actions/checkout@v4" },
        { run: "git push origin HEAD" },
        { run: "cat packages/app/version.txt" },
        { run },
      ]),
    });
    const finding = report.findings.find((f) => f.ruleId === sparseId);
    expect(finding?.message).toContain("uses only a narrow working tree");
    expect(finding?.why).toContain("full-history requirement is not visible");
  },
);

test.each(["git log --oneline", 'echo "$(git log --oneline)"'])(
  "actual history evidence still strengthens the explanation: %s",
  async (run) => {
    const report = await scan({
      ci: workflow([
        { uses: "actions/checkout@v4" },
        { run },
        { run: "cat packages/app/version.txt" },
      ]),
    });
    expect(report.findings.find((f) => f.ruleId === sparseId)?.message).toContain(
      "history available",
    );
  },
);

for (const [kind, ruleId] of [
  ["sparse", sparseId],
  ["blob", blobId],
] as const) {
  test.each([
    "echo audit",
    "echo 'npm ci'",
    "# npm ci\necho audit",
    "echo 'rg --files'",
    "echo 'npm run build'",
    "echo 'claude update docs'",
  ])(`${kind} peer logs cannot erase valid structured precedents: %s`, async (run) => {
    const tail =
      kind === "sparse" ? { run: "cat packages/app/version.txt" } : { run: "gh release view" };
    const report = await scan({
      target: workflow([{ uses: "actions/checkout@v4", with: { "fetch-depth": 0 } }, tail]),
      peer: workflow([
        {
          uses: "actions/checkout@v4",
          with: {
            "fetch-depth": 0,
            ...(kind === "sparse"
              ? { "sparse-checkout": "packages/app" }
              : { filter: "blob:none" }),
          },
        },
        tail,
        { run },
      ]),
    });
    const finding = report.findings.find(
      (f) => f.ruleId === ruleId && f.workflow === ".github/workflows/target.yml",
    );
    expect(finding?.why).toContain(".github/workflows/peer.yml");
  });

  test(`${kind} actual install still disqualifies a metadata-only precedent`, async () => {
    const tail =
      kind === "sparse" ? { run: "cat packages/app/version.txt" } : { run: "gh release view" };
    const report = await scan({
      target: workflow([{ uses: "actions/checkout@v4", with: { "fetch-depth": 0 } }, tail]),
      peer: workflow([
        {
          uses: "actions/checkout@v4",
          with: {
            "fetch-depth": 0,
            ...(kind === "sparse"
              ? { "sparse-checkout": "packages/app" }
              : { filter: "blob:none" }),
          },
        },
        tail,
        { run: "npm ci" },
      ]),
    });
    expect(
      report.findings.find(
        (f) => f.ruleId === ruleId && f.workflow === ".github/workflows/target.yml",
      )?.why,
    ).not.toContain(".github/workflows/peer.yml");
  });
}

test.each(["echo audit", "echo 'sparse-checkout'", "# sparse-checkout\necho audit"])(
  "large-file advice needs structured sparse configuration: %s",
  async (run) => {
    const report = await scan(
      { ci: workflow([{ uses: "actions/checkout@v4" }, { run }], "Checks") },
      { "data/large.csv": "0".repeat(11 * 1024 * 1024) },
      true,
    );
    const finding = report.findings.find((f) => f.ruleId === "detected-large-files");
    expect(finding?.message).toContain("not configured");
    expect(finding?.suggestion).toContain("adding `sparse-checkout`");
  },
);

test("real sparse checkout retains configured large-file wording", async () => {
  const report = await scan(
    {
      ci: workflow([{ uses: "actions/checkout@v4", with: { "sparse-checkout": "src" } }], "Checks"),
    },
    { "data/large.csv": "0".repeat(11 * 1024 * 1024) },
    true,
  );
  expect(report.findings.find((f) => f.ruleId === "detected-large-files")?.message).toContain(
    "already configured",
  );
});

test.each([
  "echo audit",
  "echo 'pip install tox tox-uv'",
  "# pip install tox tox-uv\necho audit",
  "pip install --index-url tox-uv tox",
])("tox repository evidence agrees with actual plugin installation: %s", async (run) => {
  const report = await scan(
    { ci: workflow([{ run: "tox" }, { run }], "Checks") },
    { "tox.ini": "[tox]\nenvlist=py\n[testenv]\ncommands=pytest\n" },
    true,
  );
  expect(
    report.findings.some((f) => f.ruleId === "tox-without-tox-uv" && f.scope === "repository"),
  ).toBe(true);
});

test.each(["pip install tox tox-uv", 'echo "$(pip install tox tox-uv)"'])(
  "actual tox plugin install suppresses both surfaces: %s",
  async (run) => {
    const report = await scan(
      { ci: workflow([{ run: "tox" }, { run }], "Checks") },
      { "tox.ini": "[tox]\nenvlist=py\n" },
      true,
    );
    expect(report.findings.some((f) => f.ruleId === "tox-without-tox-uv")).toBe(false);
  },
);

test("printed tox does not claim CI executes tox", async () => {
  const report = await scan(
    { ci: workflow([{ run: "echo ' tox '" }], "Checks") },
    { "tox.ini": "[tox]\nenvlist=py\n" },
    true,
  );
  expect(
    report.findings.find((f) => f.ruleId === "tox-without-tox-uv" && f.scope === "repository")
      ?.message,
  ).toStartWith("Repository uses tox");
});
