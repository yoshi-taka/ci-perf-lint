import { afterEach, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker, writeRepositoryFiles } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(async () => tempDirs.cleanup());
const ci =
  "on: push\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm run lint\n";
async function analyze(files: Record<string, string>) {
  const root = await tempDirs.create("apl-tooling-evidence-");
  await writeRepositoryFiles(root, { ".github/workflows/ci.yml": ci, ...files });
  return analyzeRepository({ cwd: root, targetPath: ".", mode: "exploratory", topCount: 10000 });
}

test("Husky hook locations stay relative to the analyzed external repository", async () => {
  const report = await analyze({
    "package.json": '{"devDependencies":{"husky":"9.1.7"}}',
    ".husky/pre-commit": '#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\neslint .\n',
  });
  const finding = report.findings.find((f) => f.ruleId === "redundant-bootstrap-in-husky-hook");
  expect(finding?.location.path).toBe(".husky/pre-commit");
  expect(finding?.location.line).toBe(2);
});

test("modern locked Husky and ESLint suppress obsolete upgrade findings", async () => {
  const report = await analyze({
    "package.json": JSON.stringify({
      name: "test",
      devDependencies: { husky: "^9.0.0", eslint: "^9.26.0" },
      scripts: { lint: "eslint ." },
    }),
    ".husky/pre-commit": "eslint .\n",
    "yarn.lock":
      '__metadata:\n  version: 8\n"husky@npm:^9.0.0":\n  version: 9.1.7\n  resolution: "husky@npm:9.1.7"\n"eslint@npm:^9.26.0":\n  version: 9.39.2\n  resolution: "eslint@npm:9.39.2"\n',
  });
  expect(report.findings.some((f) => f.ruleId === "outdated-husky-version")).toBe(false);
  const findings = report.findings.filter((f) => f.ruleId === "prefer-eslint-concurrency");
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every((f) => f.severity === "suggestion" && !f.message.includes("below"))).toBe(
    true,
  );
});

test("an unresolved caret lower bound does not prove an obsolete minor", async () => {
  const report = await analyze({
    "package.json": JSON.stringify({
      devDependencies: {
        husky: "^9.0.0",
        eslint: "^9.26.0",
        typescript: "^5.0.4",
        jest: "^30.0.0",
        next: "^14.0.0",
        storybook: "^7.0.0",
      },
    }),
    ".husky/pre-commit": "eslint .\n",
  });
  for (const id of [
    "outdated-husky-version",
    "prefer-eslint-concurrency",
    "prefer-typescript-5-performance-milestone",
    "prefer-jest-30-for-jest-29",
    "prefer-nextjs-14-minor-performance-milestone",
    "prefer-storybook-7-minor-performance-milestone",
  ]) {
    expect(report.findings.some((f) => f.ruleId === id)).toBe(false);
  }
});

test.each(["npm:@voidzero-dev/vite-plus-test@0.1.16", "file:../vitest-0.1.0"])(
  "Vitest migration ignores unrelated package identity %s",
  async (spec) => {
    const report = await analyze({
      "package.json": JSON.stringify({ devDependencies: { vitest: spec } }),
    });
    expect(report.findings.some((f) => f.ruleId === "prefer-vitest-performance-milestone")).toBe(
      false,
    );
  },
);

test("locked Vitest major is respected rather than the declared lower major", async () => {
  const report = await analyze({
    "package.json": JSON.stringify({ name: "test", devDependencies: { vitest: "^4.1.0" } }),
    "package-lock.json": JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { devDependencies: { vitest: "^4.1.0" } },
        "node_modules/vitest": { version: "4.2.0" },
      },
    }),
  });
  expect(
    report.findings.find((f) => f.ruleId === "prefer-vitest-performance-milestone")?.message,
  ).toContain("Vitest 4.2.0");
});

test("complex lint-staged without Husky is not lost at the collector gate", async () => {
  const report = await analyze({
    "package.json": JSON.stringify({
      devDependencies: { "lint-staged": "16.0.0" },
      "lint-staged": {
        "*.ts": ["eslint --fix", "prettier --write"],
        "*.json": ["prettier --write"],
      },
    }),
  });
  const findings = report.findings.filter(
    (f) => f.ruleId === "prefer-lefthook-for-complex-git-hooks",
  );
  expect(findings.some((f) => f.scope === "repository" && f.location.path === "package.json")).toBe(
    true,
  );
});

test.each([
  ["root workspace lock", "yarn", "yarn install --immutable", ".", "yarn.lock", false],
  ["nested independent install", "yarn", "yarn install --immutable", "web", "yarn.lock", true],
  [
    "nested inline cd install",
    "yarn",
    "cd web && yarn install --immutable",
    ".",
    "yarn.lock",
    true,
  ],
  ["different manager's root lock", "npm", "npm ci", ".", "yarn.lock", true],
] as const)("setup-node cache: %s", async (...[_name, manager, run, cwd, rootLock, expected]) => {
  const report = await analyze({
    "package.json": "{}",
    [rootLock]: "",
    [manager === "npm" ? "web/package-lock.json" : "web/yarn.lock"]: "",
    ".github/workflows/ci.yml": `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v6\n        with:\n          cache: ${manager}\n      - run: ${run}\n        working-directory: ${cwd}\n`,
  });
  expect(report.findings.some((f) => f.ruleId === "setup-node-cache-dependency-path-unset")).toBe(
    expected,
  );
});

test("custom checkout path does not make a source-root lock a workspace-root cache key", async () => {
  const report = await analyze({
    "package.json": "{}",
    "yarn.lock": "",
    ".github/workflows/ci.yml":
      "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n        with:\n          path: source\n      - uses: actions/setup-node@v6\n        with:\n          cache: yarn\n      - run: yarn install\n        working-directory: source\n",
  });
  const finding = report.findings.find(
    (f) => f.ruleId === "setup-node-cache-dependency-path-unset",
  );
  expect(finding?.message).toContain("outside the workspace root");
  expect(finding?.suggestion).toContain("source/yarn.lock");
});
