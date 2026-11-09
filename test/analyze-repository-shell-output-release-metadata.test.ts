import { afterEach, expect, test } from "bun:test";
import { stringify } from "yaml";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "consider-filter-blob-none-for-release-metadata";

async function scan(
  run: string,
  options: { depth?: number; sparse?: boolean; extra?: Record<string, unknown>[] } = {},
) {
  const cwd = await tempDirs.create("apl-shell-release-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": stringify({
      name: "Release notes",
      on: "push",
      jobs: {
        release: {
          "runs-on": "ubuntu-latest",
          steps: [
            {
              uses: "actions/checkout@v4",
              with: {
                "fetch-depth": options.depth ?? 0,
                ...(options.sparse ? { "sparse-checkout": ".github\nscripts" } : {}),
              },
            },
            { name: "Generate changelog / git log / release notes", run },
            ...(options.extra ?? []),
          ],
        },
      },
    }),
  });
  return analyzeRepository({ cwd, targetPath: ".", topCount: 100, mode: "exploratory" });
}

test.each([
  ["git log --oneline", true],
  ["gh release view v1", true],
  ["npx git-cliff", true],
  ["gh api repos/org/repo/releases", true],
  ["echo 'git log --oneline'", false],
  ["printf '%s' 'gh release view v1'", false],
  ["# git log\necho done", false],
  ["echo done", false],
  ['echo "$(git log --oneline)"', true],
  ["echo '$(git log)'", false],
  ["grep 'git log' output.log", false],
  ["cat changelog.txt", false],
  ["gh api --field endpoint=/releases repos/org/repo/issues", false],
  ["gh api --header '/releases' repos/org/repo/issues", false],
  ["gh release view --help", false],
  ["git log --help", false],
] as const)("release metadata needs actual command evidence: %s", async (run, expected) => {
  const report = await scan(run, { sparse: true });
  expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(expected);
});

test.each([
  ["git fetch --depth=2000 origin next", true],
  ["sudo -n git fetch --depth 2000 origin next", true],
  ["echo 'git fetch --depth=2000 origin next'", false],
  ["printf '%s' 'git fetch --depth=2000 origin next'", false],
  ["# git fetch --depth=2000\necho done", false],
  ["git fetch origin next\necho --depth=2000", false],
  ["git fetch --depth=2000 --filter=blob:none origin next", false],
  ["git fetch --depth=2000 --filter blob:none origin next", false],
  ["git fetch --depth=2000 origin next\necho --filter=blob:none", true],
  ["git fetch --upload-pack '--depth=2000' origin next", false],
  ["git fetch --depth=2000 --dry-run origin next", false],
  ["git fetch --depth=2000 -- origin --filter=blob:none", true],
] as const)(
  "fetch depth/filter evidence belongs to the fetch invocation: %s",
  async (run, expected) => {
    const report = await scan(run);
    const finding = report.findings.find((f) => f.ruleId === ruleId);
    expect(Boolean(finding)).toBe(expected);
    if (finding) {
      expect(finding.suggestion).toContain("git fetch --depth");
    }
  },
);

test("recognized release action remains metadata evidence", async () => {
  const report = await scan("echo done", { extra: [{ uses: "softprops/action-gh-release@v2" }] });
  expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(true);
});

test.each([
  [{ uses: "./.github/actions/release" }],
  [{ run: "npm ci && npm run build" }],
  [{ run: "find . -type f" }],
  [{ run: "fd ." }],
  [{ run: "git grep version" }],
] as const)("repository-content safety guards remain: %j", async (extra) => {
  const report = await scan("git log --oneline", { extra: [extra] });
  expect(report.findings.some((f) => f.ruleId === ruleId)).toBe(false);
});
