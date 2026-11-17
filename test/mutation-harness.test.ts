import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { testTempRoot } from "./temp-root.ts";
import type { ResolvedMutationConfig } from "../src/mutation/config.ts";
import { runMutationConfig } from "../src/mutation/runner.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(testTempRoot(), "ci-perf-lint-harness-"));
  roots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "test"), { recursive: true });
  await writeFile(
    path.join(root, "src", "value.ts"),
    "export function value(): number {\n  return 1 + 1;\n}\n",
  );
  await writeFile(
    path.join(root, "test", "value.test.ts"),
    'import { expect, test } from "bun:test";\nimport { value } from "../src/value.ts";\ntest("value", () => { expect(value()).toBe(2); });\n',
  );
  return root;
}

function configFor(root: string): ResolvedMutationConfig {
  return {
    name: "harness-test",
    configPath: path.join(root, "mutation.config.mjs"),
    projectRoot: root,
    command: "bun test test/value.test.ts",
    targets: [{ file: "src/value.ts" }],
    timeoutMS: 3000,
    inPlace: true,
    ignorePatterns: [],
    reporters: ["clear-text"],
    tempDirName: ".mutation-tmp/harness-test",
    cleanTempDir: true,
  };
}

describe("in-process harness", () => {
  test("updates non-function exports through the per-mutant module mock", async () => {
    const root = await project();
    await writeFile(path.join(root, "src", "value.ts"), "export const VALUES = [1, 2];\n");
    await writeFile(
      path.join(root, "test", "value.test.ts"),
      'import { expect, test } from "bun:test";\nimport { VALUES } from "../src/value.ts";\ntest("values", () => { expect(VALUES).toHaveLength(2); });\n',
    );
    const summary = await runMutationConfig(configFor(root), { jobs: 1 });
    expect(summary.metrics.killed).toBeGreaterThan(0);
  });

  test("runs mutants through the persistent child and keeps statuses", async () => {
    const root = await project();
    const summary = await runMutationConfig(configFor(root), { jobs: 2 });
    expect(summary.metrics.total).toBeGreaterThan(0);
    expect(summary.metrics.killed).toBeGreaterThan(0);
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export function value(): number {\n  return 1 + 1;\n}\n",
    );
    expect(await Bun.file(path.join(root, ".mutation-tmp", "harness-test")).exists()).toBe(false);
  });
});
