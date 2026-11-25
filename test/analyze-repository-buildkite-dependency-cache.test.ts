import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTempDirTracker, memoizedAnalyzeRepository } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

function getFixtureReport(
  cwd: string,
  options: Omit<Parameters<typeof memoizedAnalyzeRepository>[0], "cwd">,
) {
  return memoizedAnalyzeRepository({ cwd, ...options });
}

async function writePipeline(root: string, lines: string[]) {
  const dir = path.join(root, ".buildkite");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pipeline.yml"), ["steps:", ...lines].join("\n"));
}

async function findings(root: string) {
  const report = await getFixtureReport(root, {
    targetPath: ".",
    topCount: 10,
    mode: "exploratory",
  });
  return report.findings.filter(
    (finding) => finding.ruleId === "missing-dependency-cache-buildkite",
  );
}

describe("missing-dependency-cache-buildkite", () => {
  test.each(["path: node_modules", "paths: [packages/app/node_modules]"])(
    "recognizes dependency paths on custom cache plugins (%s)",
    async (setting) => {
      const root = await tempDirs.create("apl-bk-depcache-custom-path-");
      await writePipeline(root, [
        "  - command: npm ci && npm test",
        "    plugins:",
        "      - example/cacher#v1:",
        `          ${setting}`,
      ]);
      expect(await findings(root)).toHaveLength(0);
    },
  );

  test.each(["path: build", "description: node_modules", "path: not_node_modules"])(
    "does not infer dependency caching from unrelated configuration (%s)",
    async (setting) => {
      const root = await tempDirs.create("apl-bk-depcache-unrelated-path-");
      await writePipeline(root, [
        "  - command: npm ci && npm test",
        "    plugins:",
        "      - example/cacher#v1:",
        `          ${setting}`,
      ]);
      expect(await findings(root)).toHaveLength(1);
    },
  );
  test("flags a colocated install without any cache", async () => {
    const root = await tempDirs.create("apl-bk-depcache-colocated-");
    await writePipeline(root, ["  - label: Tests", "    command: npm ci && npm test"]);
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("installs dependencies without a cache");
  });

  test("does not flag when the pipeline sets a cache attribute", async () => {
    const root = await tempDirs.create("apl-bk-depcache-attr-");
    const dir = path.join(root, ".buildkite");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "pipeline.yml"),
      [
        "cache:",
        '  - "node_modules"',
        "steps:",
        "  - label: Tests",
        "    command: npm ci && npm test",
      ].join("\n"),
    );
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag when the cache plugin is present", async () => {
    const root = await tempDirs.create("apl-bk-depcache-plugin-");
    await writePipeline(root, [
      "  - label: Tests",
      "    command: npm ci && npm test",
      "    plugins:",
      "      - cache#v2.5.1:",
      "          key: v1",
      "          paths: [node_modules]",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag buildkite-agent cache invocations", async () => {
    const root = await tempDirs.create("apl-bk-depcache-agent-");
    await writePipeline(root, [
      "  - label: Tests",
      "    command: |",
      "      buildkite-agent cache restore --key v1",
      "      npm ci && npm test",
      "      buildkite-agent cache save node_modules --key v1",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag artifact handoff from a standalone install step", async () => {
    const root = await tempDirs.create("apl-bk-depcache-artifact-");
    await writePipeline(root, [
      "  - label: Install",
      "    command: npm ci",
      "    artifact_paths: [node_modules/**]",
      "  - wait",
      "  - label: Tests",
      "    command: npm test",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("flags a standalone install step with no handoff", async () => {
    const root = await tempDirs.create("apl-bk-depcache-standalone-");
    await writePipeline(root, [
      "  - label: Install",
      "    command: npm ci",
      "  - wait",
      "  - label: Tests",
      "    command: npm test",
    ]);
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("only installs dependencies");
  });

  test("does not flag an install step with nothing to feed", async () => {
    const root = await tempDirs.create("apl-bk-depcache-lonely-");
    await writePipeline(root, ["  - label: Install", "    command: npm ci"]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag custom s3-backed dependency storage", async () => {
    const root = await tempDirs.create("apl-bk-depcache-s3-");
    await writePipeline(root, [
      "  - label: Tests",
      "    command: |",
      "      aws s3 sync s3://our-deps/npm node_modules",
      "      npm ci && npm test",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag non-install steps", async () => {
    const root = await tempDirs.create("apl-bk-depcache-none-");
    await writePipeline(root, ["  - label: Build", "    command: make build"]);
    expect(await findings(root)).toHaveLength(0);
  });
});
