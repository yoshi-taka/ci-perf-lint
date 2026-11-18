import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  getWorkflowFocusedFixtureReport,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const ruleId = "ineffective-cache-save-condition";
const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };

interface JobOptions {
  on?: unknown;
  cacheStep?: unknown;
  runs?: string[];
}

async function findings({ on, cacheStep, runs = ["cargo build --locked"] }: JobOptions = {}) {
  const root = await tempDirs.create("apl-cache-save-condition-");
  await writeRepositoryFiles(root, {
    ".github/workflows/release.yml": stringify({
      name: "Release",
      on: on ?? { push: { tags: ["v*"] }, pull_request: null },
      jobs: {
        build: {
          "runs-on": "ubuntu-22.04",
          steps: [
            { uses: "actions/checkout@v7" },
            { uses: "dtolnay/rust-toolchain@stable" },
            cacheStep ?? {
              uses: "Swatinem/rust-cache@v2",
              with: { "save-if": "${{ github.ref == 'refs/heads/main' }}" },
            },
            ...runs.map((run) => ({ run })),
          ],
        },
      },
    }),
  });
  const report = await getWorkflowFocusedFixtureReport(root, options);
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe(ruleId, () => {
  test("flags the leaf-style tag-and-PR release workflow baseline", async () => {
    const report = await getWorkflowFocusedFixtureReport(
      fixtures.ineffectiveCacheSaveConditionLike,
      options,
    );
    const matches = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(matches).toHaveLength(2);
    expect(matches.every((finding) => finding.severity === "warning")).toBe(true);
    expect(matches[0]?.message).toContain('Job "pull-request-build"');
    expect(matches[0]?.message).toContain("github.ref == 'refs/heads/main'");
    expect(matches[1]?.message).toContain('Job "test"');

    const strict = await getWorkflowFocusedFixtureReport(
      fixtures.ineffectiveCacheSaveConditionLike,
      {
        ...options,
        mode: "strict",
      },
    );
    const strictMatches = strict.findings.filter((finding) => finding.ruleId === ruleId);
    expect(strictMatches).toHaveLength(2);
    expect(strictMatches.every((finding) => finding.severity === "warning")).toBe(true);
  });

  test("does not flag reachable save conditions or explicit constants", async () => {
    const report = await getWorkflowFocusedFixtureReport(
      fixtures.ineffectiveCacheSaveConditionOk,
      options,
    );
    const matches = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(matches).toHaveLength(0);
  });

  test.each([
    ["ref equality", "${{ github.ref == 'refs/heads/main' }}"],
    ["ref_name equality", "${{ github.ref_name == 'main' }}"],
    [
      "event equality conjunction",
      "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    ],
    ["unquoted comparison", "github.ref == 'refs/heads/main'"],
    ["double-quoted literal", '${{ github.ref == "refs/heads/main" }}'],
    ["whole-expression double quotes", "\"${{ github.ref == 'refs/heads/main' }}\""],
    ["whole-expression single quotes", "'${{ github.ref == 'refs/heads/main' }}'"],
    ["case-insensitive context", "${{ GitHub.REF == 'refs/heads/main' }}"],
  ])("detects %s in a tag-and-PR workflow", async (_name, condition) => {
    const matches = await findings({
      cacheStep: { uses: "Swatinem/rust-cache@v2", with: { "save-if": condition } },
    });
    expect(matches).toHaveLength(1);
  });

  test("detects a gated actions/cache/save step", async () => {
    const matches = await findings({
      cacheStep: {
        uses: "actions/cache/save@v4",
        with: { path: "~/.cargo", key: "cargo-${{ hashFiles('Cargo.lock') }}" },
        if: "${{ github.ref == 'refs/heads/main' }}",
      },
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain("actions/cache/save");
  });

  test.each([
    ["PR-only workflow", { pull_request: null }],
    ["tag-only workflow", { push: { tags: ["v*"] } }],
  ])("flags branch-ref save-if in a %s", async (_name, on) => {
    expect(await findings({ on })).toHaveLength(1);
  });

  test("flags a branch-ref save-if when the push branches exclude it", async () => {
    expect(
      await findings({ on: { push: { branches: ["release"] }, pull_request: null } }),
    ).toHaveLength(1);
  });

  test("flags ref_name equality when tag patterns cannot produce the name", async () => {
    const matches = await findings({
      cacheStep: {
        uses: "Swatinem/rust-cache@v2",
        with: { "save-if": "${{ github.ref_name == 'main' }}" },
      },
    });
    expect(matches).toHaveLength(1);
  });

  test.each([
    ["branches include the save-if branch", { push: { branches: ["main"] }, pull_request: null }],
    ["unfiltered push", { push: null, pull_request: null }],
    ["workflow_dispatch can select any ref", { push: { tags: ["v*"] }, workflow_dispatch: null }],
    [
      "schedule runs on the default branch",
      { push: { tags: ["v*"] }, schedule: [{ cron: "0 2 * * *" }] },
    ],
    [
      "pull_request_target runs on base refs",
      { push: { tags: ["v*"] }, pull_request_target: null },
    ],
  ])("abstains for a %s", async (_name, on) => {
    expect(await findings({ on })).toHaveLength(0);
  });

  test.each([
    ["tag-prefixed refs", "${{ startsWith(github.ref, 'refs/tags/') }}"],
    ["event-only condition", "${{ github.event_name == 'push' }}"],
    ["pull_request event", "${{ github.event_name == 'pull_request' }}"],
    ["explicit false constant", "false"],
    ["quoted false constant", '"false"'],
    ["boolean false", false],
    ["negation", "${{ github.ref != 'refs/tags/v*' }}"],
    ["disjunction", "${{ github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master' }}"],
    ["unknown context", "${{ env.SAVE_CACHE == 'true' }}"],
    ["format call", "${{ format('refs/heads/{0}', inputs.branch) }}"],
  ])("does not flag %s", async (_name, condition) => {
    const step =
      typeof condition === "string"
        ? { uses: "Swatinem/rust-cache@v2", with: { "save-if": condition } }
        : { uses: "Swatinem/rust-cache@v2", with: { "save-if": condition } };
    expect(await findings({ cacheStep: step })).toHaveLength(0);
  });

  test("flags a heads form when no branch ref is reachable", async () => {
    const matches = await findings({
      cacheStep: {
        uses: "Swatinem/rust-cache@v2",
        with: { "save-if": "${{ startsWith(github.ref, 'refs/heads/') }}" },
      },
    });
    expect(matches).toHaveLength(1);
  });

  test("flags a tags form when the push filter is branches-only", async () => {
    const matches = await findings({
      on: { push: { branches: ["release"] } },
      cacheStep: {
        uses: "Swatinem/rust-cache@v2",
        with: { "save-if": "${{ startsWith(github.ref, 'refs/tags/') }}" },
      },
    });
    expect(matches).toHaveLength(1);
  });

  test("consolidates one finding per job across multiple offending steps", async () => {
    const root = await tempDirs.create("apl-cache-save-condition-multi-");
    await writeRepositoryFiles(root, {
      ".github/workflows/release.yml": stringify({
        name: "Release",
        on: { push: { tags: ["v*"] }, pull_request: null },
        jobs: {
          build: {
            "runs-on": "ubuntu-22.04",
            steps: [
              { uses: "actions/checkout@v7" },
              { uses: "dtolnay/rust-toolchain@stable" },
              {
                uses: "Swatinem/rust-cache@v2",
                with: { "save-if": "${{ github.ref == 'refs/heads/main' }}" },
              },
              { run: "cargo build --locked" },
              {
                uses: "actions/cache/save@v4",
                with: { path: "target", key: "target-${{ github.sha }}" },
                if: "${{ github.ref_name == 'main' }}",
              },
            ],
          },
        },
      }),
    });
    const report = await getWorkflowFocusedFixtureReport(root, options);
    const matches = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain('Job "build"');
  });
});

describe("missing-paths-filter tag-only push with pull_request", () => {
  test("flags the unfiltered pull_request side of a tag-triggered release workflow", async () => {
    const report = await getWorkflowFocusedFixtureReport(
      fixtures.ineffectiveCacheSaveConditionLike,
      options,
    );
    const matches = report.findings.filter(
      (finding) =>
        finding.ruleId === "missing-paths-filter" &&
        finding.workflow === ".github/workflows/release.yml",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("pull_request trigger does not narrow execution");
  });

  test("keeps exempting a tag-only workflow without pull_request", async () => {
    const report = await getWorkflowFocusedFixtureReport(fixtures.iamtrailLike, options);
    const matches = report.findings.filter((finding) => finding.ruleId === "missing-paths-filter");
    expect(matches).toHaveLength(0);
  });
});
