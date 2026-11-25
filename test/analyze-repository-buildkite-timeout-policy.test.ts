import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import {
  createTempDirTracker,
  memoizedAnalyzeRepository,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function findings(
  setting: string,
  mode: "strict" | "exploratory" = "exploratory",
  stepLines: string[] = ["    command: make build"],
) {
  const root = await tempDirs.create("apl-bk-timeout-policy-");
  await writeRepositoryFiles(root, {
    [path.join(".buildkite", "pipeline.yml")]: [
      "steps:",
      "  - label: Build",
      ...stepLines,
      "    plugins:",
      "      - example/build#v1:",
      `          ${setting}`,
    ].join("\n"),
  });
  const report = await memoizedAnalyzeRepository({
    cwd: root,
    targetPath: ".",
    workflowOnly: true,
    mode,
    topCount: 100,
  });
  return report.findings.filter(
    (finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite",
  );
}

test.each([
  "timeout: 120",
  "timeout: '120'",
  "timeout: 0.5",
  "timeout: 30s",
  "timeout: 10m",
  "timeout_in_minutes: 15",
  "timeout-in-minutes: 15",
])("plugin operation timeout does not bound a separate command (%s)", async (setting) => {
  const found = await findings(setting);
  expect(found).toHaveLength(1);
  expect(found[0]?.severity).toBe("suggestion");
  expect(found[0]?.suggestion).toContain("not hooks or other commands");
});

test("plugin-only work still needs review of job-wide timeout coverage", async () => {
  expect(await findings("timeout: 600", "exploratory", [])).toHaveLength(1);
});

test("explicit step timeout exempts the step independently of plugin settings", async () => {
  expect(
    await findings("timeout: 600", "exploratory", [
      "    command: make build",
      "    timeout_in_minutes: 15",
    ]),
  ).toHaveLength(0);
});

test.each([
  "timeout: 0",
  "timeout: -1",
  "timeout: false",
  "timeout: null",
  "timeout: ''",
  "timeout: .inf",
  "timeout: 0s",
  "timeout: '${LIMIT}'",
  "description: timeout",
  "settings: {timeout: 10}",
])("does not infer a limit from disabled or unknown configuration (%s)", async (setting) => {
  const found = await findings(setting);
  expect(found).toHaveLength(1);
  expect(found[0]?.severity).toBe("suggestion");
});

test("strict mode does not report the low-priority timeout suggestion", async () => {
  expect(await findings("image: builder", "strict")).toHaveLength(0);
});
