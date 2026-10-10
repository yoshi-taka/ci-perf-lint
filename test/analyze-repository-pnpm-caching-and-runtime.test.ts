import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepository } from "../src/repo.ts";
import { createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterAll(async () => {
  await tempDirs.cleanup();
});

const setup = `      - uses: pnpm/action-setup@v6
        with:
          version: 12.10.0
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm`;
const install = "      - run: pnpm install --frozen-lockfile";
const manualStore = `      - uses: actions/cache@v5
        with:
          path: ~/.local/share/pnpm/store
          key: pnpm-store`;

function workflow(steps: string, extra = "", runner = "ubuntu-latest"): string {
  return `name: CI
on: push
jobs:
  test:
    runs-on: ${runner}
${extra}
    steps:
${steps}
`;
}

function cacheStep(target: string, action = "actions/cache@v5"): string {
  return `      - uses: ${action}
        with:
          path: ${target}
          key: pnpm-cache`;
}

const cases: Record<string, string> = {
  modern: workflow(`${setup}\n${install}`),
  old: workflow(`${setup.replace("12.10.0", "10.0.0")}\n${install}`),
  unspecified: workflow(
    `${setup.replace("          version: 12.10.0", "          run_install: false")}\n${install}`,
  ),
  manual: workflow(`${manualStore}\n${install}`),
  "restore-only": workflow(
    `${manualStore.replace("actions/cache@", "actions/cache/restore@")}\n${install}`,
  ),
  "action-store": workflow(`      - uses: pnpm/action-setup@v6
        with:
          version: 12.10.0
          cache: true
${install}`),
  "inline-install": workflow(`      - uses: pnpm/action-setup@v6
        with:
          cache: true
          run_install: true`),
  "corepack-install": workflow(
    `${manualStore}\n      - run: CI=true corepack pnpm i --frozen-lockfile`,
  ),
  "store-output": workflow(`      - id: store
        run: echo "path=$(pnpm store path)" >> "$GITHUB_OUTPUT"
${cacheStep("${{ steps.store.outputs.path }}")}
${install}`),
  "metadata-file": workflow(
    `${setup}\n${cacheStep("~/.cache/pnpm/lockfile-verified.jsonl")}\n${install}`,
  ),
  "metadata-directory": workflow(`${setup}\n${cacheStep("~/.cache/pnpm")}\n${install}`),
  "macos-metadata": workflow(
    `${setup}\n${cacheStep("~/Library/Caches/pnpm")}\n${install}`,
    "",
    "macos-latest",
  ),
  "windows-metadata": workflow(
    `${setup}\n${cacheStep("'C:/Users/runner/LocalAppData/pnpm-cache'")}\n${install}`,
    "",
    "windows-latest",
  ),
  "whole-cache": workflow(`${setup}\n${cacheStep("~/.cache")}\n${install}`),
  "metadata-output": workflow(`${setup}
      - id: metadata
        run: echo "path=$(pnpm cache path)" >> "$GITHUB_OUTPUT"
${cacheStep("${{ steps.metadata.outputs.path }}")}
${install}`),
  "save-metadata-only": workflow(
    `${setup}\n${cacheStep("~/.cache/pnpm", "actions/cache/save@v5")}\n${install}`,
  ),
  "dynamic-cache": workflow(`${setup}\n${cacheStep("${{ env.METADATA_PATH }}")}\n${install}`),
  "already-setup": workflow(`${setup}\n      - uses: pnpm/setup@v3\n${install}`),
  "no-cache": workflow(install),
  "no-install": workflow(setup),
  echo: workflow(`${setup}\n      - run: echo "pnpm install"`),
  comment: workflow(`${setup}\n      - run: |\n          # pnpm install\n          pnpm test`),
  "npm-install": workflow(`${setup}\n      - run: npm ci`),
  "late-cache": workflow(`${install}\n${manualStore}`),
  "save-only": workflow(
    `${manualStore.replace("actions/cache@", "actions/cache/save@")}\n${install}`,
  ),
  "disabled-cache": workflow(
    `${manualStore.replace("        with:", "        if: false\n        with:")}\n${install}`,
  ),
  "disabled-install": workflow(`${setup}\n      - if: false\n        run: pnpm install`),
  "disabled-job": workflow(`${setup}\n${install}`, "    if: false"),
  "cache-off": workflow(`${setup}\n${install}`, "    cache-mode: none"),
  "cache-write-only": workflow(`${setup}\n${install}`, "    cache-mode: write-only"),
  "self-hosted": workflow(`${setup}\n${install}`, "", "[self-hosted, linux]"),
  "two-installs": workflow(`${setup}\n${install}\n${install}`),
};

describe("analyzeRepository: pnpm caching and runtime", () => {
  let report: Awaited<ReturnType<typeof analyzeRepository>>;
  beforeAll(async () => {
    const root = await tempDirs.create("apl-pnpm-cache-");
    const directory = path.join(root, ".github", "workflows");
    await mkdir(directory, { recursive: true });
    await Promise.all(
      Object.entries(cases).map(([name, source]) =>
        writeFile(path.join(directory, `${name}.yml`), source),
      ),
    );
    report = await analyzeRepository({
      cwd: root,
      targetPath: ".",
      mode: "strict",
      topCount: 200,
    });
  });

  function findings(name: string, rule = "prefer-pnpm-setup-for-store-only-cache") {
    return report.findings.filter(
      (finding) => finding.ruleId === rule && finding.workflow === `.github/workflows/${name}.yml`,
    );
  }

  test.each([
    "modern",
    "old",
    "unspecified",
    "manual",
    "restore-only",
    "action-store",
    "inline-install",
    "corepack-install",
    "store-output",
    "save-metadata-only",
  ])("suggests migration for %s", (name) => {
    expect(findings(name)).toHaveLength(1);
    expect(findings(name)[0]?.severity).toBe("warning");
    expect(findings(name)[0]?.suggestion).toContain("pnpm/setup v2.1.0");
    expect(findings(name)[0]?.suggestion).toContain("install: false");
  });

  test.each([
    "metadata-file",
    "metadata-directory",
    "macos-metadata",
    "windows-metadata",
    "whole-cache",
    "metadata-output",
    "dynamic-cache",
    "already-setup",
    "no-cache",
    "no-install",
    "echo",
    "comment",
    "npm-install",
    "late-cache",
    "save-only",
    "disabled-cache",
    "disabled-install",
    "disabled-job",
    "cache-off",
    "cache-write-only",
    "self-hosted",
  ])("avoids an unsupported migration for %s", (name) => {
    expect(findings(name)).toHaveLength(0);
  });

  test("retains existing upgrade advice for old pnpm", () => {
    expect(findings("old", "prefer-pnpm-12-10")).toHaveLength(1);
    expect(findings("modern", "prefer-pnpm-12-10")).toHaveLength(0);
    expect(findings("old")[0]?.suggestion).toContain("pnpm 10 or older");
  });

  test("reports once for multiple installs in the same job", () => {
    expect(findings("two-installs")).toHaveLength(1);
  });
});
