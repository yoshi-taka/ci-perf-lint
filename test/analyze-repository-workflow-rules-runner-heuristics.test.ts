import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

type SimpleRunnerCase = {
  name: string;
  fixture: string;
  ruleId: string;
  mode: "exploratory" | "strict";
  expectFinding: boolean;
  severity?: "error" | "warning" | "suggestion";
  messageContains?: string[];
  suggestionContains?: string;
};

const baseOptions = (mode: "exploratory" | "strict") =>
  ({ targetPath: ".", topCount: 20, mode }) as const;

describe("analyzeRepository workflow and execution rules: docker and runner heuristics", () => {
  test("suggests reconsidering Alpine or musl images for real CI execution paths", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.alpineCiLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "consider-slim-over-alpine-for-ci",
    );

    expect(report.workflowCount).toBe(1);
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.message).toContain('Job "test_in_alpine"');
    expect(finding?.suggestion).toContain("slim Debian-based image");
    expect(
      report.findings.some(
        (candidate) =>
          candidate.ruleId === "consider-slim-over-alpine-for-ci" &&
          candidate.message.includes("noop_in_alpine"),
      ),
    ).toBe(false);
  });

  describe("simple positive and negative cases", () => {
    const simpleCases: SimpleRunnerCase[] = [
      { name: "warns when an ARM-only Docker build relies on QEMU emulation", fixture: fixtures.qemuArmLike, ruleId: "prefer-native-arm-runner-over-qemu", mode: "strict", expectFinding: true, severity: "warning", messageContains: ['Job "docker" uses QEMU', "linux/arm64"], suggestionContains: "native arm64 runner" },
      { name: "keeps QEMU guidance advisory for mixed amd64 and arm64 Docker builds", fixture: fixtures.qemuMultiPlatformLike, ruleId: "prefer-native-arm-runner-over-qemu", mode: "exploratory", expectFinding: true, severity: "suggestion", messageContains: ["linux/amd64, linux/arm64"], suggestionContains: "multiple native Buildx nodes" },
      { name: "does not flag QEMU when the visible Docker build does not target ARM", fixture: fixtures.qemuUnusedLike, ruleId: "prefer-native-arm-runner-over-qemu", mode: "exploratory", expectFinding: false },
      { name: "does not flag QEMU when the job already runs on a visible ARM runner", fixture: fixtures.qemuArmNativeRunnerOk, ruleId: "prefer-native-arm-runner-over-qemu", mode: "exploratory", expectFinding: false },
      { name: "detects shell-based docker buildx ARM targets too", fixture: fixtures.qemuShellBuildxLike, ruleId: "prefer-native-arm-runner-over-qemu", mode: "exploratory", expectFinding: true, severity: "suggestion", messageContains: ["linux/amd64, linux/arm64"] },
      { name: "does not recommend arm64 API CLI runners when already arm64 or containerized", fixture: fixtures.apiDeployArmRunnerOk, ruleId: "prefer-standard-arm-runner-for-api-cli", mode: "exploratory", expectFinding: false },
      { name: "does not recommend arm64 portable tooling runners when already arm64, containerized, or mixed with typecheck", fixture: fixtures.portableToolingArmRunnerOk, ruleId: "prefer-standard-arm-runner-for-portable-tooling", mode: "strict", expectFinding: false },
      { name: "does not flag D:\\ drive paths, expressions, or non-Windows runners", fixture: fixtures.avoidCDriveOnWindowsRunnerOk, ruleId: "avoid-c-drive-on-windows-runner", mode: "strict", expectFinding: false },
      { name: "does not flag slim Debian-based container images", fixture: fixtures.slimCiLike, ruleId: "consider-slim-over-alpine-for-ci", mode: "exploratory", expectFinding: false },
      { name: "warns when cargo build precedes cargo test with identical conditions", fixture: fixtures.cargoBuildBeforeTestLike, ruleId: "cargo-build-before-test", mode: "strict", expectFinding: true, severity: "warning", messageContains: ['Job "test"', "cargo build", "cargo test"] },
      { name: "does not flag cargo build before cargo test when build conditions differ", fixture: fixtures.cargoBuildBeforeTestOk, ruleId: "cargo-build-before-test", mode: "strict", expectFinding: false },
    ];

    test.each(simpleCases)("$name", async ({ fixture, ruleId, mode, expectFinding, severity, messageContains, suggestionContains }) => {
      const report = await memoizedAnalyzeRepository({ cwd: fixture, ...baseOptions(mode) });

      if (!expectFinding) {
        expect(report.findings.some((c) => c.ruleId === ruleId)).toBe(false);
        return;
      }

      const finding = report.findings.find((c) => c.ruleId === ruleId);
      expect(finding).toBeDefined();
      expect(report.workflowCount).toBe(1);
      expect(finding!.severity).toBe(severity!);
      if (messageContains) {
        for (const msg of messageContains) {
          expect(finding!.message).toContain(msg);
        }
      }
      if (suggestionContains) {
        expect(finding!.suggestion).toContain(suggestionContains);
      }
    });
  });

  test("recommends standard arm64 runners for API-bound CLI commands", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.apiDeployArmRunnerLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-standard-arm-runner-for-api-cli",
    );
    const terraformFinding = findings.find((finding) =>
      finding.message.includes('Job "terraform"'),
    );
    const cdkFinding = findings.find((finding) => finding.message.includes('Job "cdk"'));
    const pulumiFinding = findings.find((finding) =>
      finding.message.includes('Job "pulumi_with_build"'),
    );

    expect(report.workflowCount).toBe(1);
    expect(terraformFinding?.severity).toBe("warning");
    expect(terraformFinding?.message).toContain("Terraform");
    expect(terraformFinding?.message).toContain("API-bound CLI work");
    expect(terraformFinding?.suggestion).toContain("ubuntu-24.04-arm");
    expect(cdkFinding?.severity).toBe("warning");
    expect(cdkFinding?.message).toContain("AWS CDK");
    expect(pulumiFinding?.severity).toBe("suggestion");
    expect(pulumiFinding?.suggestion).toContain("ubuntu-22.04-arm");
  });

  test("recommends standard arm64 runners for portable fast tooling", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.portableToolingArmRunnerLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "prefer-standard-arm-runner-for-portable-tooling",
    );
    const oxlintFinding = findings.find((finding) => finding.message.includes('Job "oxlint"'));
    const ruffFinding = findings.find((finding) => finding.message.includes('Job "ruff"'));
    const actionlintFinding = findings.find((finding) =>
      finding.message.includes('Job "actionlint"'),
    );

    expect(report.workflowCount).toBe(1);
    expect(oxlintFinding?.severity).toBe("warning");
    expect(oxlintFinding?.message).toContain("Oxlint");
    expect(oxlintFinding?.why).toContain("whole billable minute");
    expect(oxlintFinding?.suggestion).toContain("ubuntu-24.04-arm");
    expect(ruffFinding?.severity).toBe("warning");
    expect(ruffFinding?.suggestion).toContain("ubuntu-22.04-arm");
    expect(actionlintFinding?.severity).toBe("warning");
  });

  test("warns when Windows runners hardcode C:\\ drive paths", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.avoidCDriveOnWindowsRunnerLike,
      targetPath: ".",
      topCount: 20,
      mode: "strict",
    });

    const findings = report.findings.filter(
      (candidate) => candidate.ruleId === "avoid-c-drive-on-windows-runner",
    );

    expect(report.workflowCount).toBe(1);
    expect(findings.length).toBe(5);
    expect(findings.some((f) => f.message.includes('env "TEMP"'))).toBe(true);
    expect(findings.some((f) => f.message.includes("defaults.run.working-directory"))).toBe(true);
    expect(findings.some((f) => f.message.includes('env "TMP"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('"path" input'))).toBe(true);
    expect(findings.some((f) => f.message.includes("sets working-directory"))).toBe(true);
  });

  test("finds workflow-local cache, timeout, checkout, and build repetition hints", async () => {
    const report = await memoizedAnalyzeRepository({
      cwd: fixtures.workflowEfficiencyLike,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleHits = new Set(report.findings.map((finding) => finding.ruleId));

    expect(report.workflowCount).toBe(1);
    expect(ruleHits.has("redundant-manual-cache-with-setup-action")).toBe(true);
    expect(ruleHits.has("missing-timeout-minutes")).toBe(true);
    expect(ruleHits.has("duplicate-checkout-in-same-workflow")).toBe(true);
    expect(ruleHits.has("repeated-build-in-same-workflow")).toBe(true);
    expect(report.findings.some((finding) => finding.message.includes('Job "build_app"'))).toBe(
      true,
    );
    expect(report.findings.some((finding) => finding.message.includes('Job "build_docs"'))).toBe(
      true,
    );
  });

  test("flags duplicate checkout and install across jobs without build or lint commands", async () => {
    const fixtureRoot = await tempDirs.create("apl-dup-install-no-build-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "diff-dependencies.yml"),
      [
        "name: Diff Dependencies",
        "on: pull_request",
        "jobs:",
        "  build-main:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - run: npm ci",
        "  build-pr:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - run: npm ci",
        "  lint:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          cache: npm",
        "      - run: npm ci",
        "      - run: npm run lint",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const checkoutFinding = report.findings.find(
      (f) => f.ruleId === "duplicate-checkout-in-same-workflow",
    );
    expect(checkoutFinding).toBeDefined();
    expect(checkoutFinding?.message).toContain("build-main");
    expect(checkoutFinding?.message).toContain("build-pr");
    expect(checkoutFinding?.message).toContain("lint");
  });

  test("does not flag duplicated checkout or repeated builds for matrix jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-matrix-duplication-skip-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    strategy:",
        "      matrix:",
        "        package: [app, docs]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
        "  verify:",
        "    strategy:",
        "      matrix:",
        "        package: [app, docs]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: npm ci",
        "      - run: npm run build",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "duplicate-checkout-in-same-workflow" ||
          finding.ruleId === "repeated-build-in-same-workflow",
      ),
    ).toBe(false);
  });

  test("does not flag manual cache when setup action cache covers a different dependency family", async () => {
    const fixtureRoot = await tempDirs.create("apl-manual-cache-family-skip-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");

    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: CI",
        "on: push",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - uses: actions/setup-node@v4",
        "        with:",
        "          node-version: 22",
        "          cache: npm",
        "      - uses: actions/cache@v4",
        "        with:",
        "          path: .yarn/cache",
        "          key: yarn-${{ hashFiles('yarn.lock') }}",
        "      - run: npm ci",
        "      - run: npm test",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    expect(
      report.findings.some(
        (finding) => finding.ruleId === "redundant-manual-cache-with-setup-action",
      ),
    ).toBe(false);
  });
});
