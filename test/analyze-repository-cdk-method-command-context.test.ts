import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "prefer-cdk-method-direct-in-development";

async function scan(
  command: string,
  {
    environment = "sandbox",
    trigger = "pull_request",
    version = "2.1138.0",
    scriptName = "deploy:dev",
  } = {},
) {
  const cwd = await tempDirs.create("apl-cdk-method-context-");
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
  ["cdk deploy --express", true],
  ['cdk deploy --express --app "node app.js --method=direct"', true],
  ['cdk deploy --express --context "notice=value -m direct"', true],
  ["cdk deploy --express && echo --method=direct", true],
  ["cdk deploy --express # --method=direct", true],
  ["cdk deploy --express --method=direct && cdk deploy --express", true],
  ["cdk deploy --express && cdk deploy --express --method=direct", true],
  ["cdk deploy --express --method=direct", false],
  ["cdk deploy --express -mdirect", false],
  ["cdk deploy --express --method=change-set", false],
  ["cdk deploy --express --change-set-name review", false],
  ["cdk deploy --express --import-existing-resources", false],
  ["cdk deploy --express --import-existing-resources=false", true],
  ["cdk deploy --express --revert-drift", false],
  ["cdk deploy --express --revert-drift=false", true],
  ['cdk deploy --express --app "node app.js --revert-drift"', true],
  ["cdk deploy --express -- --method=direct", true],
  ["cdk --profile sandbox deploy --express", true],
  ["echo 'cdk deploy --express'", false],
  ["cdk synth --app 'cdk deploy --express'", false],
  ["cdk deploy --express --help", false],
  ["cat <<EOF\ncdk deploy --express\nEOF", false],
] as const)(
  "method command boundaries on workflow and package scripts: %s",
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

test.each([
  ["2.117.0", false],
  ["2.118.0", true],
] as const)("method-direct version gate is retained: %s", async (version, expected) => {
  expect(await scan("cdk deploy --express", { version })).toHaveLength(expected ? 2 : 0);
});

test("production remains excluded", async () => {
  expect(
    await scan("cdk deploy --express", { environment: "production", scriptName: "deploy:prod" }),
  ).toEqual([]);
});
