import { afterEach, expect, spyOn, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { repositoryDiagnosticCollectors } from "../src/repository-diagnostics/index.ts";
import type { RepositoryDiagnosticCollector } from "../src/repository-diagnostics/collector-types.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

function workflow(runs: string[], extra = ""): string {
  return `name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${runs.map((run) => `      - run: ${JSON.stringify(run)}\n`).join("")}`;
}

async function analyze(files: Record<string, string>) {
  const root = await tempDirs.create("apl-audit-collectors-");
  await writeRepositoryFiles(root, files);
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "exploratory", topCount: 10000 });
}

test.each([21, 100])(
  "precheck evaluates all %i workflows including zero-score candidates",
  async (count) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      files[`.github/workflows/build-${i}.yml`] =
        `on: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${i % 2 ? "Docker" : "docker"}/build-push-action@v6\n`;
    }
    const report = await analyze(files);
    const findings = report.findings.filter((f) => f.ruleId === "docker-build-without-layer-cache");
    expect(findings).toHaveLength(count);
    expect(new Set(findings.map((f) => f.workflow)).size).toBe(count);
  },
);

test("Depot action uses its persistent layer cache without GHA cache exports", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml":
      "on: push\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: depot/build-push-action@v1\n",
  });
  expect(report.findings.some((f) => f.ruleId === "docker-build-without-layer-cache")).toBe(false);
});

test.each([
  "-XX:SharedArchiveFile=app.jsa",
  "-Xshare:auto",
  "-XX:ArchiveClassesAtExit=app.jsa",
  "-XX:DumpLoadedClassList=classes.lst",
])("CDS detection recognizes %s with multiple JVM launches", async (flag) => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow([
      `java ${flag} -jar app.jar`,
      `java ${flag} -jar app.jar`,
    ]),
    "pom.xml": "<project/>",
  });
  expect(report.findings.some((f) => f.ruleId === "jvm-cds-opportunity-for-repeated-startup")).toBe(
    false,
  );
});

for (const asyncFailure of [false, true]) {
  test.serial(`isolates ${asyncFailure ? "async" : "sync"} collector exceptions`, async () => {
    const collector = repositoryDiagnosticCollectors.find(
      (c) => c.id === "jvm-cds-opportunity-for-repeated-startup",
    )! as RepositoryDiagnosticCollector<"hasJvm">;
    const mock = spyOn(collector, "collect");
    const error = new Error("audit collector failure");
    mock.mockImplementation(
      asyncFailure
        ? () => Promise.reject(error)
        : () => {
            throw error;
          },
    );
    try {
      const report = await analyze({
        ".github/workflows/ci.yml": workflow([
          "java -jar app.jar",
          "java -jar app.jar",
          "npm install",
        ]),
        "pom.xml": "<project/>",
      });
      expect(
        report.analysisWarnings.some(
          (w) => w.kind === "collector-error" && w.message.includes("audit collector failure"),
        ),
      ).toBe(true);
      expect(report.findings.some((f) => f.ruleId === "prefer-npm-ci")).toBe(true);
    } finally {
      mock.mockRestore();
    }
  });
}

test("package scripts independently open the JavaScript scripts gate", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(["node script.js"]),
    "package.json": '{"scripts":{"ci":"npm run lint","lint":"node lint.js"}}',
  });
  const findings = report.findings.filter((f) => f.ruleId === "prefer-node-run-over-npm-run");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe("package.json");
});

test.each(["-parallelism=30", "--parallelism=30", "-parallelism 30", "--parallelism 30"])(
  "Terraform recognizes tuned command %s",
  async (flag) => {
    const report = await analyze({
      ".github/workflows/ci.yml": workflow(["terraform init", `terraform plan ${flag}`]),
      "main.tf": 'resource "null_resource" "test" {}',
    });
    expect(report.findings.some((f) => f.ruleId === "terraform-parallelism-unconfigured")).toBe(
      false,
    );
  },
);

test("Terraform env tuning does not leak across jobs", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": `${workflow(["terraform init", "terraform plan"], "    env:\n      TF_CLI_ARGS_plan: -parallelism=30\n")}  other:\n    runs-on: ubuntu-latest\n    steps:\n      - run: terraform plan\n`,
    "main.tf": 'resource "null_resource" "test" {}',
  });
  const finding = report.findings.find((f) => f.ruleId === "terraform-parallelism-unconfigured");
  expect(finding).toBeDefined();
  expect(finding?.message).toStartWith("1 Terraform");
});

test.each([
  ["cd one && terraform init", "cd two && terraform init"],
  ["terraform -chdir=one init", "terraform -chdir=two init"],
])("Terraform checks each initialized root module", async (first, second) => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow([first, second]),
    "one/main.tf": 'resource "null_resource" "one" {}',
    "two/main.tf": 'resource "null_resource" "two" {}',
    "one/.terraform.lock.hcl": "",
  });
  const findings = report.findings.filter((f) => f.ruleId === "terraform-lockfile-missing");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.message).toContain("two/.terraform.lock.hcl");
  expect(findings[0]?.location.line).toBeGreaterThan(1);
});

test("esbuild/tsup root externals cover imported subpaths", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(["npm run build"]),
    "package.json":
      '{"dependencies":{"react":"19.0.0"},"scripts":{"build":"esbuild src/index.ts --bundle --external:react"}}',
    "esbuild.config.js": 'export default {external: ["react"]};',
    "tsup.config.ts": 'export default {external: ["react"]};',
    "src/index.ts": 'import {jsx} from "react/jsx-runtime"; export const element=jsx("div", {});',
  });
  expect(report.findings.some((f) => f.ruleId === "bundler-external-subpath-leak")).toBe(false);
});

test("an explicit Rollup subpath does not cover other subpaths or other configs", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(["npm run build"]),
    "package.json": '{"dependencies":{"react":"19.0.0"}}',
    "rollup.config.js": 'export default {external: ["react", "react/jsx-runtime"]};',
    "esbuild.config.js": 'export default {external: ["react", "react/*"]};',
    "src/index.ts":
      'import {jsxDEV} from "react/jsx-dev-runtime"; export const element=jsxDEV("div", {});',
  });
  const findings = report.findings.filter((f) => f.ruleId === "bundler-external-subpath-leak");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe("rollup.config.js");
});

test("webpack object externals still require coverage for imported subpaths", async () => {
  const report = await analyze({
    ".github/workflows/ci.yml": workflow(["npm run build"]),
    "package.json": '{"dependencies":{"react":"19.0.0"}}',
    "webpack.config.js": 'export default {externals: {react: "commonjs react"}};',
    "src/index.ts": 'import {jsx} from "react/jsx-runtime"; export const element=jsx("div", {});',
  });
  const findings = report.findings.filter((f) => f.ruleId === "bundler-external-subpath-leak");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.location.path).toBe("webpack.config.js");
});
