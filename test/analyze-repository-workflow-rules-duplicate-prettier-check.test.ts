import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(() => tempDirs.cleanup());
const rule = { id: "avoid-duplicate-prettier-check", severity: "warning" } as const;

async function findings(
  scripts: Record<string, string>,
  steps: string[],
): Promise<Awaited<ReturnType<typeof analyzeRepositoryForRule>>["findings"]> {
  const cwd = await tempDirs.create("ci-perf-dup-prettier-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify({
      private: true,
      devDependencies: { prettier: "^3.0.0", eslint: "^9.0.0" },
      scripts,
    }),
    "src/index.js": "export const value = 1;\n",
    ".github/workflows/ci.yml": `name: CI
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${steps.map((step) => `      - run: ${JSON.stringify(step)}`).join("\n")}
`,
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "exploratory" },
    rule,
  );
  return report.findings.filter((candidate) => candidate.ruleId === rule.id);
}

describe("duplicate prettier check", () => {
  test("flags a check hidden in a composite script and a dedicated step", async () => {
    const result = await findings(
      { check: "prettier --check . && eslint .", "prettier-check": "prettier --check ." },
      ["npm run check", "npm run prettier-check"],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.message).toContain("--check .");
    expect(result[0]?.message).toContain("more than once");
    expect(result[0]?.location.path).toContain(".github/workflows");
  });

  test("flags a direct check duplicated by a package script", async () => {
    expect(
      await findings({ "prettier-check": "prettier --check ." }, [
        "prettier --check .",
        "npm run prettier-check",
      ]),
    ).toHaveLength(1);
  });

  test("does not flag a single check", async () => {
    expect(
      await findings({ check: "prettier --check . && eslint ." }, ["npm run check"]),
    ).toHaveLength(0);
  });

  test("does not flag different file scopes", async () => {
    expect(
      await findings({ "prettier-check": "prettier --check src" }, [
        "prettier --check .",
        "npm run prettier-check",
      ]),
    ).toHaveLength(0);
  });

  test("does not flag a composite script without a hidden check", async () => {
    expect(
      await findings({ check: "eslint .", "prettier-check": "prettier --check ." }, [
        "npm run check",
        "npm run prettier-check",
      ]),
    ).toHaveLength(0);
  });
});
