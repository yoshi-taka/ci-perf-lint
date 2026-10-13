import { afterEach, expect, spyOn, test } from "bun:test";
import path from "node:path";
import { stringify } from "yaml";
import { RepositoryScanContext } from "../src/repository-scan-context.ts";
import { collectRepositorySignals } from "../src/repository-signals.ts";
import { collectCdkAssetBuildConcurrencyDiagnostics } from "../src/repository-diagnostics/cdk-asset-build-concurrency.ts";
import { parseWorkflow } from "../src/workflow.ts";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "prefer-cdk-asset-build-concurrency";
const job = (command: string) => ({ "runs-on": "ubuntu-latest", steps: [{ run: command }] });

async function scan(command: string, assetCount = 2, extraJobs: Record<string, unknown> = {}) {
  const cwd = await tempDirs.create("apl-cdk-assets-context-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      devDependencies: { "aws-cdk": "2.1138.0", "aws-cdk-lib": "2.267.0", typescript: "7.0.2" },
    }),
    ".github/workflows/deploy.yml": stringify({
      on: "push",
      jobs: { deploy: job(command), ...extraJobs },
    }),
    "src/assets.ts": Array.from(
      { length: assetCount },
      (_, index) => `new DockerImageAsset(scope, "Image${index}", { directory: "image${index}" });`,
    ).join("\n"),
  });
  const report = await analyzeRepositoryForRule(
    {
      cwd,
      targetPath: ".",
      topCount: 1000,
      mode: "exploratory",
    },
    { id: ruleId, severity: "suggestion" },
  );
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  ["cdk deploy", true],
  ["cdk deploy && echo --asset-build-concurrency=4", true],
  ['cdk deploy --app "node app.js --asset-build-concurrency=4"', true],
  ['cdk deploy --context "notice=value --asset-build-concurrency=4"', true],
  ["cdk deploy --asset-build-concurrency=4 && cdk deploy", true],
  ["cdk deploy && cdk deploy --asset-build-concurrency=4", true],
  ["cdk deploy # --asset-build-concurrency=4", true],
  ["cdk deploy -- --asset-build-concurrency=4", true],
  ["cdk --profile dev deploy", true],
  ["npx --yes cdk deploy", true],
  ["cdk deploy --asset-build-concurrency 4", false],
  ["cdk deploy --asset-build-concurrency=1", false],
  ["echo 'cdk deploy'", false],
  ["cdk synth --app 'cdk deploy'", false],
  ["cdk destroy", false],
  ["cdk deploy --help", false],
  ["cat <<EOF\ncdk deploy\nEOF", false],
] as const)("repository asset concurrency command boundaries: %s", async (command, expected) => {
  expect(await scan(command)).toHaveLength(expected ? 1 : 0);
});

test.each([0, 1])("fewer than two Docker assets stays excluded: %s", async (assetCount) => {
  expect(await scan("cdk deploy", assetCount)).toEqual([]);
});

test("a tuned job cannot hide another job's deploy", async () => {
  expect(
    await scan("cdk deploy --asset-build-concurrency=4", 2, { untuned: job("cdk deploy") }),
  ).toHaveLength(1);
});

test.each([
  "echo 'cdk deploy'",
  "cdk deploy --asset-build-concurrency=4",
  "cat <<EOF\ncdk deploy\nEOF",
])("does not scan source for inactive or tuned deploy text: %s", async (command) => {
  const cwd = await tempDirs.create("apl-cdk-assets-no-scan-");
  await writeRepositoryFiles(cwd, { "package.json": "{}" });
  const context = new RepositoryScanContext(cwd, []);
  const { signals } = await collectRepositorySignals(cwd, [], [], context);
  const workflow = parseWorkflow(
    path.join(cwd, ".github/workflows/deploy.yml"),
    cwd,
    stringify({ on: "push", jobs: { deploy: job(command) } }),
  );
  const walk = spyOn(context, "walkFiles");
  try {
    expect(
      await collectCdkAssetBuildConcurrencyDiagnostics(cwd, signals, [workflow], [], context),
    ).toEqual([]);
    expect(walk).not.toHaveBeenCalled();
  } finally {
    walk.mockRestore();
  }
});
