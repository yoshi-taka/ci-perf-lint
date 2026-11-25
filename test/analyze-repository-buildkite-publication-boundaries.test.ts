import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function findings(command: string, label = "Build") {
  const root = await tempDirs.create("apl-bk-publication-boundary-");
  await writeRepositoryFiles(root, {
    ".buildkite/pipeline.yml": [
      "steps:",
      `  - label: ${JSON.stringify(label)}`,
      `    command: ${JSON.stringify(command)}`,
      "  - label: Tests",
      "    command: npm test",
    ].join("\n"),
  });
  const report = await analyzeRepository({
    cwd: root,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 100,
  });
  expect(report.analysisWarnings.filter((warning) => warning.kind === "rule-error")).toEqual([]);
  return report.findings;
}

test.each([
  "fastlane pilot",
  "fastlane ios beta",
  "fastlane run upload_to_testflight",
  "bundle exec fastlane ios build_and_upload_prototype_build",
  "npm run upload_to_app_store",
  "drivah build --push .",
  "depot build --push=true .",
  "custom-builder build --push .",
  "xargs -n1 docker push",
  "/usr/bin/xargs -n1 docker push",
  "xargs --replace docker push '{}'",
  "xargs --max-lines docker push",
  "xargs -I{} depot build --push '{}'",
  "timeout 30 drivah build --push .",
])(
  "treats mobile distribution and wrapped image publication as deployment (%s)",
  async (command) => {
    const found = await findings(command);
    expect(found.filter((finding) => finding.ruleId === "missing-if-changed")).toEqual([]);
    const cancel = found.filter((finding) => finding.ruleId === "missing-cancel-on-build-failing");
    expect(cancel).toHaveLength(1);
    expect(cancel[0]?.aiHandoff).toContain('step "Tests"');
  },
);

test.each(["Upload to TestFlight", "App Store", "Fastlane beta"])(
  "recognizes mobile distribution labels (%s)",
  async (label) => {
    expect(
      (await findings("./opaque.sh", label)).filter(
        (finding) => finding.ruleId === "missing-if-changed",
      ),
    ).toEqual([]);
  },
);

test.each([
  "fastlane scan",
  "bundle exec fastlane run_tests",
  "fastlane --env beta scan",
  "fastlane action upload_to_testflight",
  "fastlane pilot list",
  "echo 'fastlane pilot --push'",
  "grep -- --push build.log",
  "pytest --push",
  "constructor build --push",
  "depot build --push=false .",
  "drivah build --label --push .",
  "depot build -- --push",
  "custom-builder build --help --push .",
])("does not mistake test lanes or argument data for publication (%s)", async (command) => {
  const found = await findings(command);
  expect(found.some((finding) => finding.ruleId === "missing-if-changed")).toBe(true);
});
