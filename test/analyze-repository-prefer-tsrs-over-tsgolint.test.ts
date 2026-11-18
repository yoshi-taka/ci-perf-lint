import { afterEach, describe, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import {
  createTempDirTracker,
  memoizedAnalyzeRepository,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

const options = { targetPath: ".", topCount: 100, mode: "exploratory" as const };
const ruleId = "prefer-tsrs-over-tsgolint";

const workflow = {
  name: "CI",
  on: { pull_request: null, push: { branches: ["main"] } },
  jobs: {
    lint: {
      "runs-on": "ubuntu-latest",
      steps: [
        { uses: "actions/checkout@v7" },
        { uses: "oven-sh/setup-bun@v2" },
        { run: "bun install --frozen-lockfile" },
        { run: "bun run lint" },
        { run: "bun run typecheck" },
      ],
    },
  },
};

async function findings(packageJson: Record<string, unknown>) {
  const root = await tempDirs.create("apl-prefer-tsrs-");
  await writeRepositoryFiles(root, {
    ".github/workflows/ci.yml": stringify(workflow),
    "package.json": JSON.stringify(packageJson, null, 2),
  });
  const report = await analyzeRepository({ cwd: root, ...options });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

function packageJsonWith(
  devDependencies: Record<string, string>,
  scripts?: Record<string, string>,
) {
  return {
    name: "candidate",
    private: true,
    scripts: scripts ?? {
      lint: "oxlint --type-aware",
      typecheck: "oxlint --type-aware --type-check",
    },
    devDependencies,
  };
}

describe(ruleId, () => {
  test("flags a v7 tsgolint stack without tsrs", async () => {
    const matches = await findings(
      packageJsonWith({
        oxlint: "^1.86.0",
        "oxlint-tsgolint": "^7.0.2003",
        typescript: "^7.0.2",
      }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("warning");
    expect(matches[0]?.message).toContain("oxlint-tsgolint type-aware backend but not tsrs");
  });

  test("fixture baseline fires and the adopted fixture stays silent", async () => {
    const like = await memoizedAnalyzeRepository({
      cwd: fixtures.preferTsrsOverTsgolintLike,
      ...options,
    });
    expect(like.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(1);
    const ok = await memoizedAnalyzeRepository({
      cwd: fixtures.preferTsrsOverTsgolintOk,
      ...options,
    });
    expect(ok.findings.filter((f) => f.ruleId === ruleId)).toHaveLength(0);
  });

  test("keeping tsgolint beside tsrs stays silent (fallback is valid)", async () => {
    expect(
      await findings(
        packageJsonWith({
          oxlint: "^1.93.0",
          "oxlint-tsgolint": "^7.0.2003",
          tsrs: "0.23.0",
          typescript: "^7.0.2",
        }),
      ),
    ).toHaveLength(0);
  });

  test("TypeScript 6 stacks abstain until the TypeScript 7 migration", async () => {
    expect(
      await findings(
        packageJsonWith({
          oxlint: "1.73.0",
          "oxlint-tsgolint": "0.24.0",
          typescript: "6.0.3",
        }),
      ),
    ).toHaveLength(0);
  });

  test("typescript 7 alone also qualifies a v6-era tsgolint pin", async () => {
    const matches = await findings(
      packageJsonWith({
        oxlint: "^1.90.0",
        "oxlint-tsgolint": "^0.23.0",
        typescript: "^7.0.2",
      }),
    );
    expect(matches).toHaveLength(1);
  });

  test("repositories without the tsgolint backend stay out of scope", async () => {
    expect(
      await findings(
        packageJsonWith({
          oxlint: "^1.93.0",
          tsrs: "0.23.0",
          typescript: "^7.0.2",
        }),
      ),
    ).toHaveLength(0);
    expect(
      await findings(
        packageJsonWith({
          oxlint: "^1.93.0",
          typescript: "^7.0.2",
        }),
      ),
    ).toHaveLength(0);
  });

  test("a script invoking tsrs without the dependency stays silent", async () => {
    expect(
      await findings(
        packageJsonWith(
          {
            oxlint: "^1.86.0",
            "oxlint-tsgolint": "^7.0.2003",
            typescript: "^7.0.2",
          },
          {
            lint: "oxlint --type-aware",
            typecheck: "oxlint --type-aware --type-check",
            "lint:tsrs": "pnpx tsrs --lint",
          },
        ),
      ),
    ).toHaveLength(0);
  });
});
