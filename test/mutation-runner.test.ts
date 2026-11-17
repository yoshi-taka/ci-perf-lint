import { testTempRoot } from "./temp-root.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveMutationConfig, type ResolvedMutationConfig } from "../src/mutation/config.ts";
import { runMutationConfig } from "../src/mutation/runner.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeProject(source: string): Promise<string> {
  const root = await mkdtemp(path.join(testTempRoot(), "ci-perf-lint-mutation-"));
  tempDirs.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "value.ts"), source);
  return root;
}

function configFor(
  root: string,
  overrides: Partial<ResolvedMutationConfig> = {},
): ResolvedMutationConfig {
  return {
    name: "test",
    configPath: path.join(root, "mutation.config.mjs"),
    projectRoot: root,
    command: 'bun -e "process.exit(0)"',
    targets: [{ file: "src/value.ts" }],
    timeoutMS: 3000,
    inPlace: true,
    ignorePatterns: [],
    reporters: ["clear-text"],
    tempDirName: ".mutation-tmp/test",
    cleanTempDir: true,
    ...overrides,
  };
}

describe("mutation runner", () => {
  test("classifies killed mutants and restores sources", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    const summary = await runMutationConfig(
      configFor(root, {
        command:
          "bun -e \"const s=require('fs').readFileSync('src/value.ts','utf8'); process.exit(s.includes('1 - 1') ? 1 : 0)\"",
      }),
    );
    expect(summary.metrics.total).toBe(1);
    expect(summary.metrics.killed).toBe(1);
    expect(summary.metrics.survived).toBe(0);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const value = 1 + 1;\n",
    );
  });

  test("classifies survived mutants and reports them", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    const summary = await runMutationConfig(configFor(root));
    expect(summary.metrics.survived).toBe(1);
    expect(summary.files[0]?.mutants[0]?.status).toBe("Survived");
  });

  test("classifies timed out mutants and removes per-mutant temp dirs", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    const command =
      "bun -e \"const fs=require('fs');const root=process.env.CI_PERF_LINT_TEST_TMP;if(!root?.includes('.mutation-tmp')) process.exit(7); fs.writeFileSync(root+'/leak.txt','x'); const s=fs.readFileSync('src/value.ts','utf8'); if (s.includes('1 - 1')) { await Bun.sleep(5000); }\"";
    const summary = await runMutationConfig(configFor(root, { command, timeoutMS: 300 }));
    expect(summary.metrics.timeout).toBe(1);
    expect(await Bun.file(path.join(root, ".mutation-tmp", "test")).exists()).toBe(false);
  });

  test("fails when the baseline test run fails", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    await rejects(
      runMutationConfig(configFor(root, { command: 'bun -e "process.exit(3)"' })),
      /Baseline test run failed/,
    );
  });

  test("runs in a sandbox without touching the project", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    const summary = await runMutationConfig(configFor(root, { inPlace: false }));
    expect(summary.metrics.total).toBe(1);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const value = 1 + 1;\n",
    );
    expect(await Bun.file(path.join(root, ".mutation-tmp", "test")).exists()).toBe(false);
  });

  test("forceSandbox keeps in-place sources untouched and skips the test preload", async () => {
    const root = await makeProject("export const value = 1 + 1;\n");
    const summary = await runMutationConfig(
      configFor(root, {
        inPlace: true,
        command:
          "bun -e \"const s=require('fs').readFileSync('bunfig.toml','utf8'); process.exit(s.includes('preload') ? 1 : 0)\"",
      }),
      { forceSandbox: true },
    );
    expect(summary.metrics.total).toBe(1);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const value = 1 + 1;\n",
    );
  });

  test("runs mutants in parallel sandboxes without touching the project", async () => {
    const root = await makeProject("export const a = 1 + 1;\nexport const b = 2 + 2;\n");
    const summary = await runMutationConfig(configFor(root, { inPlace: true }), { jobs: 2 });
    expect(summary.metrics.total).toBe(2);
    expect(summary.metrics.survived).toBe(2);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const a = 1 + 1;\nexport const b = 2 + 2;\n",
    );
  });

  test("recovers an interrupted in-place run from its backup", async () => {
    const root = await makeProject("export const value = 1 - 1;\n");
    const backup = path.join(root, ".mutation-tmp", "test", "backup", "src", "value.ts");
    await mkdir(path.dirname(backup), { recursive: true });
    await writeFile(backup, "export const value = 1 + 1;\n");
    const summary = await runMutationConfig(configFor(root));
    expect(summary.metrics.total).toBe(1);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const value = 1 + 1;\n",
    );
  });

  test("filters mutants by line range", async () => {
    const root = await makeProject("export const first = 1 + 1;\nexport const second = 2 + 2;\n");
    const summary = await runMutationConfig(
      configFor(root, { targets: [{ file: "src/value.ts", lineRange: { start: 2, end: 2 } }] }),
    );
    expect(summary.metrics.total).toBe(1);
    expect(summary.files[0]?.mutants[0]?.line).toBe(2);
  });

  test("rejects configs outside the supported surface", () => {
    const base = {
      testRunner: "command",
      commandRunner: { command: "true" },
      mutate: ["src/value.ts"],
      coverageAnalysis: "off",
    };
    const context = { configPath: "/tmp/example.config.mjs", projectRoot: "/tmp" };
    expect(() => resolveMutationConfig({ ...base, testRunner: "vitest" }, context)).toThrow(
      "Unsupported testRunner",
    );
    expect(() => resolveMutationConfig({ ...base, coverageAnalysis: "perTest" }, context)).toThrow(
      "Unsupported coverageAnalysis",
    );
    expect(() => resolveMutationConfig({ ...base, concurrency: 2 }, context)).toThrow(
      "Unsupported concurrency",
    );
    expect(() => resolveMutationConfig({ ...base, mutate: ["src/*.ts"] }, context)).toThrow(
      "Glob mutate entries",
    );
    expect(() => resolveMutationConfig({ ...base, reporters: ["html"] }, context)).toThrow(
      "Unsupported reporter",
    );
    expect(() => resolveMutationConfig({ ...base, thresholds: { high: 80 } }, context)).toThrow(
      "thresholds are not supported",
    );
  });

  test("parses mutate line ranges", () => {
    const config = resolveMutationConfig(
      {
        testRunner: "command",
        commandRunner: { command: "true" },
        mutate: ["src/value.ts:12-34"],
        coverageAnalysis: "off",
      },
      { configPath: "/tmp/example.config.mjs", projectRoot: "/tmp" },
    );
    expect(config.targets).toEqual([{ file: "src/value.ts", lineRange: { start: 12, end: 34 } }]);
    expect(config.timeoutMS).toBe(5000);
  });
});
