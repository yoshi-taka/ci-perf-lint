import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "prefer-cdk-express-mode-in-development";

async function scan(
  command: string,
  {
    environment = "sandbox",
    trigger = "pull_request",
    version = "2.1138.0",
    scriptName = "deploy:dev",
  } = {},
) {
  const cwd = await tempDirs.create("apl-cdk-express-context-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      devDependencies: { "aws-cdk": version },
      scripts: { [scriptName]: command },
    }),
    ".github/workflows/deploy.yml": stringify({
      on: trigger,
      jobs: { deploy: { "runs-on": "ubuntu-latest", environment, steps: [{ run: command }] } },
    }),
  });
  const report = await analyzeRepository({ cwd, targetPath: ".", topCount: 1000, mode: "strict" });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

test.each([
  ["cdk deploy", true],
  ["cdk destroy", true],
  ["cdk bootstrap", true],
  ["cdk deploy --express=false", true],
  ["cdk deploy --express false", true],
  ["cdk deploy --no-express", true],
  ["cdk deploy --express --no-express", true],
  ["cdk deploy --express=false --express", false],
  ["cdk deploy --express", false],
  ["cdk deploy --express=true", false],
  ["cdk deploy && echo --express", true],
  ["cdk deploy && cdk deploy --express", true],
  ["cdk deploy --express && cdk deploy", true],
  ['cdk deploy --app "node app.js --express"', true],
  ['cdk deploy --context "notice=value --express"', true],
  ["cdk deploy # --express", true],
  ["cdk deploy -- --express", true],
  ["npx --yes cdk deploy", true],
  ["npx aws-cdk@2.1138.0 deploy", true],
  ["echo 'cdk deploy'", false],
  ["cdk synth --app 'cdk deploy'", false],
  ["cdk deploy --help", false],
  ["cat <<EOF\ncdk deploy\nEOF", false],
  ["cdk deploy $OPTIONS", false],
] as const)(
  "express command boundaries on workflow and package scripts: %s",
  async (command, expected) => {
    const findings = await scan(command);
    expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(
      expected ? 1 : 0,
    );
    expect(findings.filter((finding) => finding.scope !== "repository")).toHaveLength(
      expected ? 1 : 0,
    );
  },
);

test("disabled express mode keeps CLI upgrade advice", async () => {
  const findings = await scan("cdk deploy --express=false", { version: "2.1100.0" });
  expect(findings).toHaveLength(2);
  expect(findings.every((finding) => finding.suggestion.includes("Upgrade"))).toBe(true);
});

test("production context and non-development scripts stay excluded", async () => {
  expect(
    await scan("cdk deploy --express=false", {
      environment: "production",
      scriptName: "deploy:prod",
    }),
  ).toEqual([]);
});

test("manual workflows stay excluded while development scripts are checked", async () => {
  const findings = await scan("cdk deploy", { environment: "", trigger: "workflow_dispatch" });
  expect(findings.filter((finding) => finding.scope !== "repository")).toEqual([]);
  expect(findings.filter((finding) => finding.scope === "repository")).toHaveLength(1);
});
