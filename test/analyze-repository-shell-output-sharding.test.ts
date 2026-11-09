import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(job: Record<string, unknown>, root: Record<string, unknown> = {}) {
  const cwd = await tempDirs.create("apl-shell-sharding-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({ on: "push", ...root, jobs: { check: job } }),
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 100 });
}

test.each([
  ["ccache --set-config compiler_check=content", false],
  ["sudo -n ccache --set-config=compiler_check=content", false],
  ["echo 'ccache --set-config compiler_check=content'", true],
  ["printf '%s' 'ccache --set-config=compiler_check=content'", true],
  ["# ccache --set-config compiler_check=content\necho done", true],
  ['echo "$(ccache --set-config compiler_check=content)"', false],
  ["echo '$(ccache --set-config compiler_check=content)'", true],
  ["ccache --show-config && echo --set-config=compiler_check=content", true],
  ["ccache --set-config=compiler_check=contentious", true],
  ["ccache --help --set-config=compiler_check=content", true],
] as const)("ccache workaround requires executed configuration: %s", async (run, expected) => {
  const report = await scan({
    "runs-on": "windows-latest",
    steps: [{ uses: "hendrikmuhs/ccache-action@v1.2.19" }, { run }],
  });
  expect(report.findings.some((f) => f.ruleId === "prefer-ccache-action-1-2-20-on-windows")).toBe(
    expected,
  );
});

test.each([
  ["npx jest", true],
  ["pnpm run test", true],
  ["python -m pytest", true],
  ["echo 'npx jest'", false],
  ["printf '%s' 'npm test'", false],
  ["# npm test\necho done", false],
  ['echo "$(npx jest)"', true],
  ["npx playwright install --with-deps", false],
  ["npm test\necho '${{ matrix.shard }}'", true],
  ["npm test\n# --shard=${{ matrix.shard }}", true],
  ["npm test\nprintf '%s' '--shard=1/2'", true],
  ["npm test -- --shard=${{ matrix.shard }}/2", false],
  ["npx playwright test --shard=1/2", false],
  ["npm test -- shard.test.ts", true],
  ["npm test\ngrep '${{ matrix.shard }}' output.log", true],
  ["SHARD=${{ matrix.shard }} npm test", false],
  ["export SHARD=${{ matrix.shard }}\nnpm test", false],
  ['echo "SHARD=${{ matrix.shard }}" >> "$GITHUB_ENV"\nnpm test', false],
  ["echo 'SHARD=${{ matrix.shard }}'\nnpm test", true],
] as const)("matrix test/shard evidence excludes displayed text: %s", async (run, expected) => {
  const report = await scan({
    "runs-on": "ubuntu-latest",
    strategy: { matrix: { shard: [1, 2] } },
    steps: [{ name: "Install browsers / npm test --shard", run }],
  });
  expect(report.findings.some((f) => f.ruleId === "matrix-test-job-without-test-sharding")).toBe(
    expected,
  );
});

test.each(["workflow", "job", "step"])(
  "matrix propagation through %s environment remains conservative",
  async (level) => {
    const env = { CI_NODE_INDEX: "${{ matrix.shard }}" };
    const report = await scan(
      {
        "runs-on": "ubuntu-latest",
        strategy: { matrix: { shard: [1, 2] } },
        ...(level === "job" ? { env } : {}),
        steps: [{ run: "npm test", ...(level === "step" ? { env } : {}) }],
      },
      level === "workflow" ? { env } : {},
    );
    expect(report.findings.some((f) => f.ruleId === "matrix-test-job-without-test-sharding")).toBe(
      false,
    );
  },
);
