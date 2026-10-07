import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => tempDirs.cleanup());
async function analyze(source: string) {
  const root = await tempDirs.create("apl-workflow-evidence-");
  await writeRepositoryFiles(root, { ".github/workflows/ci.yml": source, "package.json": "{}" });
  return analyzeRepository({
    cwd: root,
    targetPath: ".",
    workflowOnly: true,
    mode: "exploratory",
    topCount: 10000,
  });
}

test.each([
  "      - uses: actions/setup-node@v6\n        with:\n          node-version-file: .nvmrc\n",
  "      - run: npx npq install --immutable\n      - run: yarn unit\n",
  "      - run: yarn integration\n        working-directory: detox/test\n",
  "      - run: npm run lint\n",
])("checkout is retained for visible repository-dependent tooling: %s", async (tooling) => {
  const report = await analyze(
    `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n${tooling}      - uses: actions/upload-artifact@v6\n        with:\n          path: results.zip\n`,
  );
  expect(
    report.findings.some((f) => f.ruleId === "unnecessary-checkout-when-only-using-artifacts"),
  ).toBe(false);
});

test("artifact-only checkout is still detected", async () => {
  const report = await analyze(
    "on: push\njobs:\n  artifacts:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/download-artifact@v6\n      - uses: actions/upload-artifact@v6\n        with:\n          path: artifact.zip\n",
  );
  expect(
    report.findings.some((f) => f.ruleId === "unnecessary-checkout-when-only-using-artifacts"),
  ).toBe(true);
});

function job(id: string, runner: string, setup: string, checkout = "", extra = "") {
  return `  ${id}:\n    runs-on: ${runner}\n${extra}    steps:\n      - uses: actions/checkout@v6\n${checkout}      - uses: actions/setup-node@v6\n        with:\n          node-version: 24\n${setup}      - run: npm ci\n      - run: npm test\n`;
}
test.each([
  ["different OS", job("linux", "ubuntu-latest", ""), job("windows", "windows-latest", "")],
  [
    "different Node",
    job("node24", "ubuntu-latest", ""),
    job("node22", "ubuntu-latest", "").replace("node-version: 24", "node-version: 22"),
  ],
  [
    "different npm client",
    job("npm9", "ubuntu-latest", "      - run: npm i -g npm@9\n"),
    job("npm10", "ubuntu-latest", "      - run: npm i -g npm@10\n"),
  ],
  [
    "different checkout refs",
    job("main", "ubuntu-latest", "", "        with:\n          ref: main\n"),
    job("pr", "ubuntu-latest", "", "        with:\n          ref: feature\n"),
  ],
  [
    "different install cwd",
    job("web", "ubuntu-latest", "").replace(
      "- run: npm ci",
      "- run: npm ci\n        working-directory: web",
    ),
    job("api", "ubuntu-latest", "").replace(
      "- run: npm ci",
      "- run: npm ci\n        working-directory: api",
    ),
  ],
  [
    "dependent job",
    job("build", "ubuntu-latest", ""),
    job("publish", "ubuntu-latest", "", "", "    needs: build\n"),
  ],
])("bootstrap does not collapse %s", async (_name, first, second) => {
  const report = await analyze(`on: push\njobs:\n${first}${second}`);
  expect(report.findings.some((f) => f.ruleId === "repeated-bootstrap-setup")).toBe(false);
});
test("bootstrap still detects compatible independent jobs", async () => {
  const report = await analyze(
    `on: push\njobs:\n${job("lint", "ubuntu-latest", "").replace("npm test", "npm run lint")}${job("test", "ubuntu-latest", "")}`,
  );
  expect(report.findings.some((f) => f.ruleId === "repeated-bootstrap-setup")).toBe(true);
});

test.each([
  "npm ping --registry http://localhost:4873",
  "npm i -g gatsby@latest",
  "npm run build",
  "npm publish",
  "npm config list",
])("npm global update is justified by npm client work: %s", async (command) => {
  const report = await analyze(
    `on: push\njobs:\n  compatibility:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm i -g npm@9\n      - run: yarn install\n      - run: ${command}\n`,
  );
  expect(report.findings.some((f) => f.ruleId === "wasteful-npm-global-install")).toBe(false);
});
test("an unrelated job's npm use does not suppress waste in another job", async () => {
  const report = await analyze(
    "on: push\njobs:\n  wasted:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm i -g npm@latest\n      - run: yarn install\n  client:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ping\n",
  );
  expect(report.findings.filter((f) => f.ruleId === "wasteful-npm-global-install")).toHaveLength(1);
});
