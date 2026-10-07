import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const ruleId = "prefer-pnpm-12-10";
const scan = (cwd: string, mode: "strict" | "exploratory" = "exploratory") =>
  analyzeRepository({ cwd, targetPath: ".", topCount: 100, mode });

describe("pnpm performance version milestone", () => {
  test("detects packageManager and groups old setup pins per job", async () => {
    const report = await scan(fixtures.pnpmVersionLike);
    const findings = report.findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(
      findings.some(
        (finding) => finding.location.path === "package.json" && finding.location.line === 3,
      ),
    ).toBe(true);
    expect(findings.some((finding) => finding.message.includes("12.9.1, 11"))).toBe(true);
    expect(report.analysisWarnings.some((warning) => warning.kind === "rule-error")).toBe(false);
  });

  test("accepts 12.10 and includes upgrade advice in strict mode", async () => {
    expect(
      (await scan(fixtures.pnpmVersionOk)).findings.some((finding) => finding.ruleId === ruleId),
    ).toBe(false);
    expect(
      (await scan(fixtures.pnpmVersionLike, "strict")).findings.some(
        (finding) => finding.ruleId === ruleId,
      ),
    ).toBe(true);
  });

  test.each([
    ["10.20.0", true],
    ["11", true],
    ["12.9.9", true],
    ["12.9.x", true],
    ["12.10.0", false],
    ["12.10.1", false],
    ["13.0.0", false],
    ["12", false],
    ["12.x", false],
    ["latest", false],
    ["${{ matrix.pnpm }}", false],
    [">=12.9 <13", false],
    ["12.10.0-rc.1", false],
    ["11.28.5+sha512.abcdef", true],
  ])("handles pnpm version %s", async (version, flagged) => {
    const cwd = await tempDirs.create("apl-pnpm-versions-");
    await writeRepositoryFiles(cwd, {
      "package.json": JSON.stringify({ private: true, packageManager: `pnpm@${version}` }),
      ".github/workflows/ci.yml": `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: pnpm/action-setup@v4\n        with:\n          version: '${version}'\n      - run: pnpm install --frozen-lockfile\n`,
    });
    const findings = (await scan(cwd)).findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(flagged ? 2 : 0);
  });

  test("reads an automatic setup pin from packageManager without scripts or dependencies", async () => {
    const cwd = await tempDirs.create("apl-pnpm-auto-");
    await writeRepositoryFiles(cwd, {
      "package.json": '{"packageManager":"pnpm@11.28.5"}',
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: pnpm/action-setup@v4\n      - run: pnpm install --frozen-lockfile\n",
    });
    const findings = (await scan(cwd)).findings.filter((finding) => finding.ruleId === ruleId);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.path).toBe("package.json");
  });

  test("ignores other package managers and setup action versions", async () => {
    const cwd = await tempDirs.create("apl-pnpm-other-");
    await writeRepositoryFiles(cwd, {
      "package.json": '{"packageManager":"yarn@4.0.0"}',
      ".github/workflows/ci.yml":
        "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          version: 10\n      - uses: pnpm/action-setup@v4\n",
    });
    expect((await scan(cwd)).findings.some((finding) => finding.ruleId === ruleId)).toBe(false);
  });
});
