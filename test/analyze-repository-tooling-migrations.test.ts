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

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

describe("migrations: python and platform tooling", () => {
  test("suggests Ruff when python jobs still use black and isort directly", async () => {
    const report = await getFixtureReport(fixtures.pythonToolingLike, {
      targetPath: ".",
      topCount: 20,
      mode: "exploratory",
    });

    const ruleHits = new Set(report.findings.map((finding) => finding.ruleId));

    expect(report.workflowCount).toBe(1);
    expect(ruleHits.has("prefer-ruff-format-over-black")).toBe(true);
    expect(ruleHits.has("prefer-ruff-import-sorting-over-isort")).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "prefer-ruff-format-over-black" && finding.message.includes("Black"),
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.ruleId === "prefer-ruff-import-sorting-over-isort" &&
          finding.message.includes("isort"),
      ),
    ).toBe(true);
  });

  test("includes Ruff migration warnings in strict mode", async () => {
    const report = await getFixtureReport(fixtures.pythonToolingLike, {
      targetPath: ".",
      topCount: 20,
    });

    const ruleHits = new Set(report.findings.map((finding) => finding.ruleId));

    expect(ruleHits.has("prefer-ruff-format-over-black")).toBe(true);
    expect(ruleHits.has("prefer-ruff-import-sorting-over-isort")).toBe(true);
  });

  test("prefers setup-bun for lightweight node tooling jobs but skips pnpm, bun, and test jobs", async () => {
    const report = await getFixtureReport(fixtures.lightweightNodeToolingLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "prefer-setup-bun-for-lightweight-node-tooling")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "lint_docs"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "lint_pnpm"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "lint_bun"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "test_app"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "release_cli"'))).toBe(false);
  });

  test("does not prefer setup-bun for Nx-orchestrated tooling jobs", async () => {
    const fixtureRoot = await tempDirs.create("apl-lightweight-node-nx-");
    await mkdir(path.join(fixtureRoot, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(fixtureRoot, ".github", "workflows", "tooling.yml"),
      [
        "name: tooling",
        "on: pull_request",
        "jobs:",
        "  peer_api:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v5",
        "      - uses: actions/setup-node@v6",
        "        with:",
        "          node-version: 24",
        "      - run: npm ci --ignore-scripts",
        "      - run: npx nx run-many -t peer-api-check",
      ].join("\n"),
    );

    const report = await getFixtureReport(fixtureRoot, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-setup-bun-for-lightweight-node-tooling",
      ),
    ).toBe(false);
  });

  test("prefers setup-uv for lightweight python tooling jobs but skips uv, release, and test jobs", async () => {
    const report = await getFixtureReport(fixtures.lightweightPythonToolingLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "prefer-setup-uv-for-lightweight-python-tooling")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "lint_python"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "lint_uv"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "release_python"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "test_python"'))).toBe(false);
  });

  test("flags redundant installs for preinstalled CLIs on supported hosted Ubuntu, Windows, and macOS runners only", async () => {
    const report = await getFixtureReport(fixtures.preinstalledCliLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "redundant-install-for-preinstalled-cli")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "aws_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "gh_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "jq_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "yq_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_aws_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_az_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_azcopy_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_gh_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_helm_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_jq_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "windows_kubectl_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_aws_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "ubuntu_az_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "ubuntu_helm_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "ubuntu_kubectl_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_az_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_azcopy_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_yq_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_helm_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "macos_kubectl_job"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "pinned_aws_job"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "pinned_windows_gh_job"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "container_job"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "self_hosted_windows_job"'))).toBe(false);
  });

  test("warns when hosted macOS jobs update Homebrew during CI", async () => {
    const report = await getFixtureReport(fixtures.macosBrewUpdateLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "avoid-brew-update-on-hosted-macos")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "ios_build"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "mac_build"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "ubuntu_brew"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "macos_container"'))).toBe(false);
  });

  test("does not warn for hosted macOS jobs that only install missing Homebrew packages", async () => {
    const report = await getFixtureReport(fixtures.macosBrewUpdateOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "avoid-brew-update-on-hosted-macos"),
    ).toBe(false);
  });

  test("warns when hosted macOS jobs install or download Xcode during CI", async () => {
    const report = await getFixtureReport(fixtures.macosXcodeInstallLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "avoid-xcode-install-on-hosted-macos")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "xcodes_install"'))).toBe(true);
    expect(hits.some((message) => message.includes("requested Xcode 16.4"))).toBe(true);
    expect(hits.some((message) => message.includes('Job "xcversion_install"'))).toBe(true);
    expect(hits.some((message) => message.includes("requested Xcode 15.4"))).toBe(true);
    expect(hits.some((message) => message.includes('Job "mise_install"'))).toBe(true);
    expect(hits.some((message) => message.includes("requested Xcode 26.2"))).toBe(true);
    expect(hits.some((message) => message.includes('Job "xip_download"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "ubuntu_xcodes_install"'))).toBe(false);
    expect(hits.some((message) => message.includes('Job "macos_container"'))).toBe(false);
  });

  test("does not warn for hosted macOS jobs that only select a preinstalled Xcode", async () => {
    const report = await getFixtureReport(fixtures.macosXcodeInstallOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "avoid-xcode-install-on-hosted-macos",
      ),
    ).toBe(false);
  });

  test("warns when tox is used without tox-uv", async () => {
    const report = await getFixtureReport(fixtures.toxWithoutToxUvLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "tox-without-tox-uv")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "test"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "lint"'))).toBe(true);
    expect(hits).toHaveLength(2);
  });

  test("skips when tox-uv is installed alongside tox", async () => {
    const report = await getFixtureReport(fixtures.toxWithoutToxUvOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "tox-without-tox-uv")).toBe(
      false,
    );
  });

  test("skips when tox is not used", async () => {
    const report = await getFixtureReport(fixtures.toxWithoutToxUvSkipNoTox, {
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "tox-without-tox-uv")).toBe(
      false,
    );
  });

  test("warns when hatch is used without uv installer", async () => {
    const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "hatch-without-uv-installer")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "test"'))).toBe(true);
    expect(hits.some((message) => message.includes("Repository"))).toBe(true);
    expect(hits).toHaveLength(2);
  });

  test("skips when hatch has uv installer configured", async () => {
    const report = await getFixtureReport(fixtures.hatchWithoutUvInstallerOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some((candidate) => candidate.ruleId === "hatch-without-uv-installer"),
    ).toBe(false);
  });

  test("warns when pdm is used without use_uv", async () => {
    const report = await getFixtureReport(fixtures.pdmWithoutUseUvLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "pdm-without-use-uv")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "test"'))).toBe(true);
    expect(hits).toHaveLength(2);
  });

  test("skips when pdm has use_uv configured", async () => {
    const report = await getFixtureReport(fixtures.pdmWithoutUseUvOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "pdm-without-use-uv")).toBe(
      false,
    );
  });

  test("warns when pip install is used despite setup-uv being available", async () => {
    const report = await getFixtureReport(fixtures.preferUvPipOverPipLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "prefer-uv-pip-over-pip")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "lint"'))).toBe(true);
    expect(hits.some((message) => message.includes('Job "test"'))).toBe(false);
    expect(hits).toHaveLength(1);
  });

  test("skips when uv pip install is already used", async () => {
    const report = await getFixtureReport(fixtures.preferUvPipOverPipOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "prefer-uv-pip-over-pip")).toBe(
      false,
    );
  });

  test("warns when nox is used without --uv flag", async () => {
    const report = await getFixtureReport(fixtures.noxWithoutUvBackendLike, {
      targetPath: ".",
      topCount: 20,
    });

    const hits = report.findings
      .filter((candidate) => candidate.ruleId === "nox-without-uv-backend")
      .map((candidate) => candidate.message);

    expect(report.workflowCount).toBe(1);
    expect(hits.some((message) => message.includes('Job "test"'))).toBe(true);
    expect(hits).toHaveLength(2);
  });

  test("skips when nox is used with --uv flag", async () => {
    const report = await getFixtureReport(fixtures.noxWithoutUvBackendOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((candidate) => candidate.ruleId === "nox-without-uv-backend")).toBe(
      false,
    );
  });

  test("warns when npm workspaces are used without Turborepo", async () => {
    const report = await getFixtureReport(fixtures.npmWorkspacesLike, {
      targetPath: ".",
      topCount: 20,
    });

    const finding = report.findings.find(
      (candidate) => candidate.ruleId === "prefer-turborepo-over-npm-workspaces",
    );

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("npm workspaces");
    expect(finding?.message).toContain("packages/*");
    expect(finding?.suggestion).toContain("Turborepo");
    expect(finding?.location.path).toContain("package.json");
  });

  test("skips when Turborepo is already used", async () => {
    const report = await getFixtureReport(fixtures.npmWorkspacesOk, {
      targetPath: ".",
      topCount: 20,
    });

    expect(
      report.findings.some(
        (candidate) => candidate.ruleId === "prefer-turborepo-over-npm-workspaces",
      ),
    ).toBe(false);
  });

  test("does not flag helm install when version is set via job-level env", async () => {
    const fixtureRoot = await tempDirs.create("apl-redun-cli-env-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: deploy",
        "on: push",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    env:",
        '      HELM_VERSION: "3.14.0"',
        "    steps:",
        "      - uses: actions/checkout@v4",
        "      - run: brew install helm",
        "      - run: helm upgrade --install myapp ./chart",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((f) => f.ruleId === "redundant-install-for-preinstalled-cli")).toBe(
      false,
    );
  });

  test("does not flag helm install when version is set via prior step export", async () => {
    const fixtureRoot = await tempDirs.create("apl-redun-cli-prior-");
    const workflowDir = path.join(fixtureRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      path.join(workflowDir, "ci.yml"),
      [
        "name: deploy",
        "on: push",
        "jobs:",
        "  deploy:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v4",
        '      - run: echo "HELM_VERSION=3.14.0" >> $GITHUB_ENV',
        "      - run: brew install helm",
        "      - run: helm version",
      ].join("\n"),
    );

    const report = await analyzeRepository({
      cwd: fixtureRoot,
      targetPath: ".",
      topCount: 20,
    });

    expect(report.findings.some((f) => f.ruleId === "redundant-install-for-preinstalled-cli")).toBe(
      false,
    );
  });
});
