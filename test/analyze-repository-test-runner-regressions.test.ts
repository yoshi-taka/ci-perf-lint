import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(packageJson: Record<string, unknown>, command = "npm test") {
  const cwd = await tempDirs.create("apl-test-runner-regression-");
  await writeRepositoryFiles(cwd, {
    "package.json": JSON.stringify(packageJson),
    ".github/workflows/ci.yml": `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          ${command.replaceAll("\n", "\n          ")}\n`,
  });
  return analyzeRepository({ cwd, targetPath: ".", mode: "exploratory", topCount: 50 });
}

describe("modern test runner adoption", () => {
  test.each([
    "node --test",
    "node --import tsx --test",
    "bun test",
    "CI=1 bun test",
    "npx vitest run",
  ])("recognizes %s in package scripts and CI despite leftover Jest", async (command) => {
    for (const surface of ["scripts", "workflow"]) {
      const report = await scan(
        {
          devDependencies: { jest: "30.5.1" },
          scripts: { test: surface === "scripts" ? command : "jest" },
        },
        surface === "workflow" ? command : "npm test",
      );
      expect(
        report.findings.some((finding) => finding.ruleId === "recommend-modern-test-runner"),
      ).toBe(false);
    }
  });

  test.each([
    "# bun test\njest",
    'echo "node --test" && jest',
    "bun run test",
    "node --test-reporter=spec tools/check.js",
  ])("does not mistake %s for a modern test run", async (command) => {
    const report = await scan(
      { devDependencies: { jest: "30.5.1" }, scripts: { test: "jest" } },
      command,
    );
    expect(
      report.findings.some((finding) => finding.ruleId === "recommend-modern-test-runner"),
    ).toBe(true);
  });
});

describe("MSW 3 migration contract", () => {
  test("advice and docs match the published entrypoints and Node requirement", async () => {
    // Offline release contract: https://github.com/mswjs/msw/blob/v3.0.0/package.json
    const exports = ["msw/http", "msw/graphql", "msw/ws", "msw/sse", "msw/utils/*"];
    const nodeRequirement = ">=22.12.0";
    const report = await scan({ devDependencies: { msw: "2.12.0" } });
    const finding = report.findings.find((item) => item.ruleId === "consider-msw-3-upgrade");
    expect(finding).toBeDefined();
    const docs = await readFile(
      new URL("../docs/rules/consider-msw-3-upgrade.md", import.meta.url),
      "utf8",
    );
    for (const text of [finding!.why, finding!.aiHandoff, docs]) {
      expect(text).toContain(`Node.js ${nodeRequirement}`);
      const imports = [...text.matchAll(/(?<![\w/])msw\/[a-z*/-]+/g)].map((match) => match[0]);
      expect(imports.length).toBeGreaterThan(0);
      for (const entrypoint of imports) {
        expect(
          exports.some(
            (key) =>
              key === entrypoint || (key.endsWith("*") && entrypoint.startsWith(key.slice(0, -1))),
          ),
        ).toBe(true);
      }
    }
  });
});
