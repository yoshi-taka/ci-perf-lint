import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(jobs: Record<string, unknown>, tag = false) {
  const cwd = await tempDirs.create("apl-dev-tool-audit-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
    "turbo.json": "{}",
    ".github/workflows/ci.yml": stringify({
      name: "PR validation",
      on: tag ? { push: { tags: ["v*"] } } : "pull_request",
      jobs,
    }),
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 100 });
}

test.each([
  ["cross build --release -p oxlint", false],
  ["cargo zigbuild --release -p oxlint", false],
  ["cargo bloat --release -p oxlint", false],
  ["cargo release-oxc --release oxlint", false],
  ["${{ matrix.build }}", false],
  ["echo oxlint", false],
  ["printf '%s' oxlint", false],
  ["npx oxlint .", true],
  ["pnpm exec oxlint .", true],
  ["env CI=true oxlint .", true],
  ["sudo -n oxlint .", true],
  ["npx --yes oxlint .", true],
  ["oxlint ${{ inputs.path }}", true],
  ["cargo fmt --check && oxlint .", true],
] as const)("tool name is not an invocation: %s", async (run, expected) => {
  const report = await scan({
    analysis: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "npm ci" }, { name: "Build oxlint for node.js", run }],
    },
  });
  for (const ruleId of [
    "unnecessary-app-install-for-lint-job",
    "prefer-standard-arm-runner-for-portable-tooling",
  ]) {
    expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(expected);
  }
});

test.each([
  "cross build -p oxlint",
  "cargo zigbuild -p oxlint",
  "${{ matrix.build }}",
  "napi build --release",
])("real lint does not make native work portable or dependencies unnecessary: %s", async (run) => {
  const report = await scan({
    analysis: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "npm ci" }, { run: "oxlint ." }, { run }],
    },
  });
  expect(
    report.findings.some((f) =>
      [
        "unnecessary-app-install-for-lint-job",
        "prefer-standard-arm-runner-for-portable-tooling",
      ].includes(f.ruleId),
    ),
  ).toBe(false);
});

test("Python toolchain install is not a full JS application install", async () => {
  const report = await scan({
    analysis: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "pip3 install cargo-zigbuild" }, { run: "oxlint ." }],
    },
  });
  expect(report.findings.some((f) => f.ruleId === "unnecessary-app-install-for-lint-job")).toBe(
    false,
  );
});

test.each([false, true])(
  "printed build/test text is not heavy; real build=%s",
  async (realBuild) => {
    const run = `PATTERN='^(build|test|release): .+'\nif ! printf '%s' "$TITLE" | grep -Eq "$PATTERN"; then\n  echo "Allowed: build test npm cargo test"\n  exit 1\nfi\n# npm run build\n${realBuild ? "npm run build" : "true"}`;
    const report = await scan({
      pr: { "runs-on": "ubuntu-latest", steps: [{ name: "Validate PR title", run }] },
    });
    expect(report.findings.some((f) => f.ruleId === "ungated-heavy-job")).toBe(realBuild);
    expect(report.findings.some((f) => f.ruleId === "missing-paths-filter")).toBe(realBuild);
  },
);

test.each([
  ["echo 'build test npm'", false],
  ["printf '%s' 'build test npm'", false],
  ["make", true],
  ["pnpm run test:api", true],
] as const)("heavy evidence retains real work behind labels: %s", async (run, expected) => {
  const report = await scan({
    pr: { "runs-on": "ubuntu-latest", steps: [{ name: "Build and test", run }] },
  });
  expect(report.findings.some((f) => f.ruleId === "ungated-heavy-job")).toBe(expected);
});

test("notification and status-only aggregation are not release consumers", async () => {
  const report = await scan(
    {
      publishRelease: { "runs-on": "ubuntu-latest", steps: [{ run: "npm publish" }] },
      reportPublishFailure: {
        needs: "publishRelease",
        if: "always() && needs.publishRelease.result != 'success'",
        "runs-on": "ubuntu-latest",
        steps: [{ uses: "slackapi/slack-github-action@v2" }],
      },
      buildPassed: {
        needs: "publishRelease",
        if: "always()",
        "runs-on": "ubuntu-latest",
        steps: [
          {
            run: "exit 1",
            if: "always() && (contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))",
          },
        ],
      },
      unsafePublish: {
        needs: "publishRelease",
        if: "always()",
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "exit 1", if: "contains(needs.*.result, 'failure')" },
          { run: "npm publish" },
        ],
      },
      unsafeOr: {
        needs: "publishRelease",
        if: "always() && (needs.publishRelease.result != 'success' || github.event_name == 'push')",
        "runs-on": "ubuntu-latest",
        steps: [{ run: "npm publish" }],
      },
    },
    true,
  );
  const findings = report.findings.filter(
    (f) => f.ruleId === "missing-release-downstream-success-guard",
  );
  expect(findings).toHaveLength(2);
  expect(findings.some((f) => f.message.includes('"unsafePublish"'))).toBe(true);
  expect(findings.some((f) => f.message.includes('"unsafeOr"'))).toBe(true);
});

test.each(["env", "cwd", "condition"])(
  "Go build step context must match: %s",
  async (difference) => {
    const report = await scan({
      build: {
        "runs-on": "ubuntu-latest",
        steps: [
          { run: "go build ./cmd/a" },
          {
            run: "go build ./cmd/b",
            ...(difference === "env"
              ? { env: { GOARCH: "arm64" } }
              : difference === "cwd"
                ? { "working-directory": "other" }
                : { if: "runner.os == 'Linux'" }),
          },
        ],
      },
    });
    expect(report.findings.some((f) => f.ruleId === "collapse-multiple-go-builds-in-job")).toBe(
      false,
    );
  },
);
