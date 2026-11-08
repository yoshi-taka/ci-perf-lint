import { afterEach, describe, expect, test } from "bun:test";
import { analyzeRepositoryForRule, createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function scan(id: string, command: string, files: Record<string, string>, extra = "") {
  const cwd = await tempDirs.create("apl-package-config-context-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml": `name: CI
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
${id === "prefer-uv-0-12" ? "      - uses: actions/setup-python@v5\n" : ""}      - run: ${JSON.stringify(command)}
${extra}`,
    ...files,
  });
  return analyzeRepositoryForRule(
    { cwd, targetPath: ".", mode: "exploratory", topCount: 1000 },
    {
      id,
      severity: id === "missing-test-worker-tuning-for-standard-runner" ? "suggestion" : "warning",
    },
  );
}

describe("lockfile context after cd", () => {
  const id = "prefer-frozen-lockfile";
  const files = {
    "src-ui/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "src-ui/.npmrc": "shamefully-hoist=true\n",
  };

  test.each([
    "cd src-ui && pnpm install",
    "cd -- src-ui && pnpm install",
    "cd src-ui\npnpm install",
    'cd "src-ui" && pnpm install',
    "cd src-ui && cd .. && cd src-ui && pnpm install",
  ])("recognizes the destination lockfile: %s", async (command) => {
    const report = await scan(id, command, files);
    expect(report.findings.filter((f) => f.ruleId === id)).toEqual([]);
  });

  test.each([
    ["cd other && pnpm install", files],
    ["cd src-ui && pnpm install --no-frozen-lockfile", files],
    ["cd src-ui && pnpm install", { ...files, "src-ui/.npmrc": "frozen-lockfile=false\n" }],
    ["cd src-ui && pnpm install", { ...files, ".npmrc": "frozen-lockfile=false\n" }],
    ["cd src-ui && CI=false pnpm install", files],
    ["cd src-ui || pnpm install", files],
    ['cd "$TARGET" && pnpm install', { "pnpm-lock.yaml": files["src-ui/pnpm-lock.yaml"] }],
  ] as const)("keeps warnings for disabled or unproven defaults: %s", async (command, input) => {
    const report = await scan(id, command, input);
    expect(report.findings.filter((f) => f.ruleId === id)).toHaveLength(1);
  });

  test("a directory change does not persist into another step", async () => {
    const report = await scan(
      id,
      "cd src-ui && pnpm install",
      files,
      "      - run: pnpm install\n",
    );
    expect(report.findings.filter((f) => f.ruleId === id)).toHaveLength(1);
  });

  test("resolves cd relative to the step working directory", async () => {
    const report = await scan(
      id,
      "cd src-ui && pnpm install",
      {
        "app/src-ui/pnpm-lock.yaml": files["src-ui/pnpm-lock.yaml"],
      },
      "        working-directory: app\n",
    );
    expect(report.findings.filter((f) => f.ruleId === id)).toEqual([]);
  });
});

describe("Playwright configuration belongs to the executing package", () => {
  const id = "missing-test-worker-tuning-for-standard-runner";
  const tuned = "export default { workers: 2 };";

  test.each([
    ["cd src-ui && pnpm exec playwright test", ""],
    ["pnpm exec playwright test", "        working-directory: src-ui\n"],
    ["cd src-ui && pnpm exec playwright test --config local.config.ts", ""],
  ])("recognizes package-local tuning: %s", async (command, extra) => {
    const report = await scan(
      id,
      command,
      {
        "src-ui/playwright.config.ts": tuned,
        "src-ui/local.config.ts": tuned,
      },
      extra,
    );
    expect(report.findings.filter((f) => f.ruleId === id)).toEqual([]);
  });

  test.each([
    ["cd src-ui && pnpm exec playwright test", "export default {};"],
    ["cd src-ui && pnpm exec playwright test", "export default { /* workers: 2 */ };"],
    ["cd src-ui && pnpm exec playwright test", "export default {\n// workers: 2\n};"],
    ["cd other && pnpm exec playwright test", tuned],
    ["cd src-ui && pnpm exec playwright test --config other.config.ts", tuned],
  ])("keeps warnings when selected tuning is absent: %s %s", async (command, config) => {
    const report = await scan(id, command, {
      "playwright.config.ts": tuned,
      "src-ui/playwright.config.ts": config,
      "src-ui/other.config.ts": "export default {};",
    });
    expect(report.findings.filter((f) => f.ruleId === id)).toHaveLength(1);
  });
});

describe("uv constraints are not necessarily the installed version", () => {
  const id = "prefer-uv-0-12";
  test.each([
    [">=0.9.0", false],
    [">0.9.0", false],
    [">=0.9.0,<1.0", false],
    [">=0.9.0,!=0.11.0", false],
    ["~=0.9", false],
    ["0.11.0", true],
    ["==0.11.0", true],
    ["0.11.x", true],
    ["^0.11.0", true],
    ["~=0.11.0", true],
    [">=0.9.0,<0.12", true],
    ["<=0.11.9", true],
    [">=0.12.0", false],
  ])("only reports constraints that force old uv: %s", async (spec, expected) => {
    const report = await scan(id, "uv sync --frozen", {
      "pyproject.toml": `[project]\nname = 'demo'\n[tool.uv]\nrequired-version = '${spec}'\n`,
    });
    expect(report.findings.some((f) => f.ruleId === id)).toBe(expected);
  });

  test("an open config floor does not hide an old workflow pin", async () => {
    const report = await scan(
      id,
      "uv sync",
      {
        "pyproject.toml": "[tool.uv]\nrequired-version = '>=0.9.0'\n",
      },
      "      - uses: astral-sh/setup-uv@v6\n        with:\n          version: '0.11.0'\n",
    );
    const hits = report.findings.filter((f) => f.ruleId === id);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.scope).not.toBe("repository");
  });
});
