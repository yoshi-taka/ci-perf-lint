import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "prefer-storybook-test-flag";
const job = (steps: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  "runs-on": "ubuntu-latest",
  ...extra,
  steps,
});

async function scan(
  jobs: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  version = "8.0.0",
) {
  const cwd = await tempDirs.create("apl-storybook-context-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({ devDependencies: { storybook: version } }),
    ".github/workflows/ci.yml": stringify({ on: "push", ...extra, jobs }),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 1000,
    mode: "exploratory",
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  ["storybook build", true],
  ["storybook build && storybook build --test", true],
  ["storybook build --test && storybook build", true],
  ["storybook build && echo --test", true],
  ['storybook build --output-dir "directory --test"', true],
  ["storybook build # --test", true],
  ["storybook build --test", false],
  ["SB_TESTBUILD=true npx storybook build", false],
  ["storybook build && echo SB_TESTBUILD=true", true],
  ["echo 'storybook build'", false],
  ["npm run build-storybook", false],
  ["cat <<EOF\nstorybook build\nEOF", false],
  ["storybook build --help", false],
] as const)("integration command ownership: %s", async (command, expected) => {
  expect(await scan({ test: job([{ run: command }, { run: "npx test-storybook" }]) })).toHaveLength(
    expected ? 1 : 0,
  );
});

test.each(["echo test-storybook", "npm install @storybook/test-runner", "echo chromatic"])(
  "consumer-like text is not a test: %s",
  async (consumer) => {
    expect(
      await scan({
        test: job([{ run: "storybook build" }, { name: "test-storybook", run: consumer }]),
      }),
    ).toEqual([]);
  },
);

test("Chromatic actions count as consumers", async () => {
  expect(
    await scan({ test: job([{ run: "storybook build" }, { uses: "chromaui/action@v1" }]) }),
  ).toHaveLength(1);
});

test("workflow ENV applies to builds", async () => {
  expect(
    await scan(
      { test: job([{ run: "storybook build" }, { run: "test-storybook" }]) },
      { env: { SB_TESTBUILD: true } },
    ),
  ).toEqual([]);
});

test("job ENV overrides workflow mode", async () => {
  expect(
    await scan(
      {
        test: job([{ run: "storybook build" }, { run: "test-storybook" }], {
          env: { SB_TESTBUILD: false },
        }),
      },
      { env: { SB_TESTBUILD: true } },
    ),
  ).toHaveLength(1);
});

test("consumer ENV does not enable test mode for the build", async () => {
  expect(
    await scan({
      test: job([
        { run: "storybook build" },
        { run: "test-storybook", env: { SB_TESTBUILD: true } },
      ]),
    }),
  ).toHaveLength(1);
});

test.each([false, "", "yes", "1", "TRUE"])(
  "step ENV overrides workflow mode: %s",
  async (value) => {
    expect(
      await scan(
        {
          test: job([
            { run: "storybook build", env: { SB_TESTBUILD: value } },
            { run: "test-storybook" },
          ]),
        },
        { env: { SB_TESTBUILD: true } },
      ),
    ).toHaveLength(1);
  },
);

test("another job's ENV cannot tune this job", async () => {
  const findings = await scan({
    tuned: job([{ run: "storybook build" }, { run: "test-storybook" }], {
      env: { SB_TESTBUILD: true },
    }),
    untuned: job([{ run: "storybook build" }, { run: "test-storybook" }]),
  });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain('"untuned"');
});

test("step-local ENV cannot hide another build", async () => {
  expect(
    await scan({
      test: job([
        { run: "storybook build", env: { SB_TESTBUILD: true } },
        { run: "storybook build" },
        { run: "test-storybook" },
      ]),
    }),
  ).toHaveLength(1);
});

test("an export does not persist across steps", async () => {
  expect(
    await scan({
      test: job([
        { run: "export SB_TESTBUILD=true\nstorybook build" },
        { run: "storybook build" },
        { run: "test-storybook" },
      ]),
    }),
  ).toHaveLength(1);
});

test("a consumer in another job does not imply test builds", async () => {
  expect(
    await scan({
      build: job([{ run: "storybook build" }]),
      test: job([{ run: "test-storybook" }]),
    }),
  ).toEqual([]);
});

test.each([
  ["7.5.0", false],
  ["7.6.0", true],
  ["8.0.0", true],
] as const)("preserves version gating for %s", async (version, expected) => {
  expect(
    await scan({ test: job([{ run: "storybook build" }, { run: "test-storybook" }]) }, {}, version),
  ).toHaveLength(expected ? 1 : 0);
});
