import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const cliRule = "redundant-install-for-preinstalled-cli";

async function scan(
  commands: string[],
  files: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  const cwd = await tempDirs.create("apl-shell-cli-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      on: "push",
      jobs: {
        check: {
          "runs-on": "ubuntu-latest",
          ...extra,
          steps: commands.map((run) => ({
            name: "Install helm v3 / gradle build / bundle exec rspec",
            run,
          })),
        },
      },
    }),
    ...files,
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 100 });
}

test.each([
  [["brew install helm", "helm version"], true],
  [["echo 'brew install helm'", "helm version"], false],
  [["brew install helm", "printf '%s' 'helm version'"], false],
  [["# brew install helm\necho done", "helm version"], false],
  [["brew install helm", 'echo "$(helm version)"'], true],
  [["brew install helm", "echo 'helm version'"], false],
  [["echo HELM_VERSION=3.14.0", "brew install helm", "helm version"], true],
  [["# HELM_VERSION=3.14.0", "brew install helm", "helm version"], true],
  [["export JQ_VERSION=1.7", "brew install helm", "helm version"], true],
  [["export HELM_VERSION=3.14.0", "brew install helm", "helm version"], false],
  [['echo "HELM_VERSION=3.14.0" >> "$GITHUB_ENV"', "brew install helm", "helm version"], false],
  [
    ["printf '%s\\n' 'HELM_VERSION=3.14.0' >> ${GITHUB_ENV}", "brew install helm", "helm version"],
    false,
  ],
  [['echo "HELM_VERSION=3.14.0" >> "$GITHUB_OUTPUT"', "brew install helm", "helm version"], true],
  [["brew install helm@3.14", "helm version"], false],
  [["pip install awscli==1.2.3", "aws sts get-caller-identity"], false],
  [["apt-get install jq=1.7", "jq . file.json"], false],
  [["sudo apt-get install other --log jq", "jq . file.json"], false],
  [
    [
      "curl --data https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 https://example.invalid/api",
      "helm version",
    ],
    false,
  ],
  [
    [
      "curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
      "helm version",
    ],
    true,
  ],
  [
    [
      "curl -H helm@3.14 https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
      "helm version",
    ],
    true,
  ],
  [
    [
      "curl --data https://example.invalid/v1.2.3 https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash",
      "helm version",
    ],
    true,
  ],
  [
    [
      "curl -LO https://dl.k8s.io/release/v1.32.0/bin/linux/amd64/kubectl",
      "kubectl version --client",
    ],
    false,
  ],
  [
    [
      "curl -LO https://dl.k8s.io/release/stable/bin/linux/amd64/kubectl",
      "kubectl version --client",
    ],
    true,
  ],
] as const)("CLI install/use/pin evidence stays separate: %j", async (commands, expected) => {
  const report = await scan([...commands]);
  expect(report.findings.some((finding) => finding.ruleId === cliRule)).toBe(expected);
});

test("structured version environment remains a pin", async () => {
  const report = await scan(
    ["brew install helm", "helm version"],
    {},
    { env: { HELM_VERSION: "3.14.0" } },
  );
  expect(report.findings.some((finding) => finding.ruleId === cliRule)).toBe(false);
});

test.each([
  ["bundle exec rspec", true],
  ["echo 'bundle exec rspec'", false],
  ["printf '%s' rails", false],
  ["# bundle install\necho done", false],
  ['echo "$(bundle exec rspec)"', true],
] as const)("Ruby workload is execution evidence: %s", async (command, expected) => {
  const report = await scan([command], {
    Gemfile: "ruby '3.2.2'\ngem 'rails', '~> 7.1.5'\n",
    ".ruby-version": "3.2.2\n",
  });
  expect(report.findings.some((finding) => finding.ruleId === "prefer-ruby-3-yjit")).toBe(expected);
});

test.each([
  ["./gradlew build", true],
  ["./gradlew :lib:test", true],
  ["sudo -n ./gradlew build", true],
  ["echo './gradlew build'", false],
  ["printf '%s' 'gradle test'", false],
  ["# gradle build\necho done", false],
  ["gradle help --task build", false],
  ["gradle properties -Pdescription=build", false],
  ["gradle run --args build", false],
  ["gradle build --dry-run", false],
  ['echo "$(./gradlew build)"', true],
  ["./gradlew publish", false],
] as const)("Gradle tasks are not names in arguments or output: %s", async (command, expected) => {
  const report = await scan([command], {
    "settings.gradle": "rootProject.name = 'example'\n",
    "build.gradle": "plugins { id 'java' }\n",
  });
  expect(report.findings.some((finding) => finding.ruleId === "missing-gradle-build-cache")).toBe(
    expected,
  );
});

test.each([
  ["npm test", true],
  ["npx jest", true],
  ["echo 'npm test'", false],
  ["printf '%s' 'npm test'", false],
  ["# npm test\necho done", false],
  ["buildkite-agent pipeline upload .buildkite/release.yml", false],
  ["echo 'buildkite-agent pipeline upload'\nnpm test", true],
  ["buildkite-agent pipeline upload .buildkite/release.yml\nnpm test", true],
  ["./build-release.sh", true],
] as const)("Buildkite upload exemption is invocation-scoped: %s", async (command, expected) => {
  const cwd = await tempDirs.create("apl-shell-bk-upload-");
  await writeRepositoryFiles(cwd, {
    ".buildkite/pipeline.yml": stringify({ steps: [{ label: "Build release pipeline", command }] }),
  });
  const report = await analyzeRepository({
    cwd,
    targetPath: ".",
    mode: "exploratory",
    topCount: 100,
  });
  expect(
    report.findings.some((finding) => finding.ruleId === "missing-timeout-in-minutes-buildkite"),
  ).toBe(expected);
});
