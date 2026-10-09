import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { parseWorkflow } from "../src/workflow.ts";
import {
  jobAllowsActionsCacheRestore,
  workflowHasCachePath,
} from "../src/rules/shared/workflow-caches.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => {
  await tempDirs.cleanup();
});

async function analyze(source: Record<string, unknown>) {
  const root = await tempDirs.create("apl-cache-policy-");
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), stringify(source));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "cache-policy",
      dependencies: { next: "16.3.0", turbo: "2.0.0", "@angular/cli": "20.0.0" },
    }),
  );
  await writeFile(
    path.join(root, "angular.json"),
    JSON.stringify({ cli: { cache: { environment: "all" } } }),
  );
  return memoizedAnalyzeRepository({
    cwd: root,
    targetPath: ".",
    topCount: 100,
    mode: "exploratory",
  });
}

describe("Actions cache policy", () => {
  test.each([
    { workflowMode: undefined, jobMode: undefined, restores: true },
    { workflowMode: "none", jobMode: undefined, restores: false },
    { workflowMode: "write-only", jobMode: undefined, restores: false },
    { workflowMode: "read", jobMode: undefined, restores: true },
    { workflowMode: "write", jobMode: undefined, restores: true },
    { workflowMode: "none", jobMode: "read", restores: true },
    { workflowMode: "write-only", jobMode: "write", restores: true },
    { workflowMode: "read", jobMode: "none", restores: false },
    { workflowMode: "write", jobMode: "write-only", restores: false },
    { workflowMode: "${{ inputs.mode }}", jobMode: undefined, restores: false },
    { workflowMode: "${{ inputs.mode }}", jobMode: "read", restores: true },
    { workflowMode: "read", jobMode: "${{ inputs.mode }}", restores: false },
  ])("restore permission: $workflowMode / $jobMode", ({ workflowMode, jobMode, restores }) => {
    const workflow = parseWorkflow(
      "/repo/.github/workflows/ci.yml",
      "/repo",
      stringify({
        on: "push",
        "cache-mode": workflowMode,
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            "cache-mode": jobMode,
            steps: [{ uses: "actions/cache@v4", with: { path: ".next/cache", key: "build" } }],
          },
        },
      }),
    );
    expect(jobAllowsActionsCacheRestore(workflow, workflow.jobs[0]!)).toBe(restores);
    expect(workflowHasCachePath(workflow, /\.next\/cache/)).toBe(restores);
  });

  test.each([undefined, "read", "write", "none", "write-only", "${{ inputs.mode }}"])(
    "cache advice respects %s",
    async (mode) => {
      const report = await analyze({
        on: "push",
        "cache-mode": mode,
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
            steps: [
              { uses: "actions/setup-node@v1" },
              { run: "npm ci" },
              { uses: "ruby/setup-ruby@v1" },
              { run: "bundle install" },
              { run: "terraform init" },
              { run: "next build" },
              { run: "turbo run build" },
              { run: "ng build" },
              { run: "sudo apt-get install -y clang llvm" },
              { uses: "docker/build-push-action@v6", with: { push: true } },
            ],
          },
        },
      });
      const expected = mode === undefined || mode === "read" || mode === "write";
      for (const ruleId of [
        "missing-dependency-cache",
        "outdated-setup-action-without-cache",
        "ruby-setup-ruby-missing-bundler-cache",
        "cache-terraform-providers",
        "missing-next-build-cache",
        "missing-turbo-cache",
        "missing-angular-cli-cache",
        "consider-caching-os-packages-or-using-a-custom-image",
        "docker-build-without-layer-cache",
      ]) {
        expect(report.findings.some((finding) => finding.ruleId === ruleId)).toBe(expected);
      }
    },
  );

  test.each([
    { mode: "read", action: "actions/cache/restore@v4", expected: true },
    { mode: "read", action: "actions/cache/save@v4", expected: false },
    { mode: "write", action: "actions/cache/save@v4", expected: true },
    { mode: "none", action: "actions/cache@v4", expected: false },
    { mode: "write-only", action: "actions/cache@v4", expected: false },
  ])("overlap: $mode / $action", async ({ mode, action, expected }) => {
    const report = await analyze({
      on: "push",
      "cache-mode": mode,
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/setup-node@v6", with: { cache: "npm" } },
            { uses: action, with: { path: "~/.npm", key: "npm" } },
            { run: "npm ci" },
          ],
        },
      },
    });
    expect(
      report.findings.some(
        (finding) => finding.ruleId === "redundant-manual-cache-with-setup-action",
      ),
    ).toBe(expected);
    expect(report.findings.some((finding) => finding.ruleId === "missing-dependency-cache")).toBe(
      false,
    );
  });

  test("read-only GHA Docker restore does not require cache export", async () => {
    const report = await analyze({
      on: "push",
      "cache-mode": "read",
      jobs: {
        build: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "docker/build-push-action@v6", with: { "cache-from": "type=gha", push: true } },
          ],
        },
      },
    });
    expect(
      report.findings.some((finding) => finding.ruleId === "docker-build-without-layer-cache"),
    ).toBe(false);
  });

  test("job overrides keep cache advice for read-enabled jobs only", async () => {
    const report = await analyze({
      on: "push",
      "cache-mode": "none",
      jobs: {
        disabled: {
          "runs-on": "ubuntu-latest",
          steps: [{ uses: "actions/setup-node@v6" }, { run: "npm ci" }],
        },
        enabled: {
          "runs-on": "ubuntu-latest",
          "cache-mode": "read",
          steps: [{ uses: "actions/setup-node@v6" }, { run: "npm ci" }],
        },
      },
    });
    const findings = report.findings.filter(
      (finding) => finding.ruleId === "missing-dependency-cache",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"enabled"');
  });
});
