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
    (finding) => finding.ruleId === "skip-checkout-on-annotation-steps",
  );
}

const TEST_SUMMARY_STEP = [
  "  - label: ':memo: Annotate'",
  "    plugins:",
  "      - test-summary#v1.0: {}",
];

describe("skip-checkout-on-annotation-steps", () => {
  test("flags a plugin-only test-summary step", async () => {
    const root = await tempDirs.create("apl-bk-checkout-skip-");
    await writePipeline(root, TEST_SUMMARY_STEP);
    const found = await findings(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("suggestion");
    expect(found[0]?.message).toContain('Step ":memo: Annotate"');
  });

  test("does not flag when checkout is already configured", async () => {
    const root = await tempDirs.create("apl-bk-checkout-set-");
    await writePipeline(root, [...TEST_SUMMARY_STEP, "    checkout:", "      skip: true"]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps with additional plugins", async () => {
    const root = await tempDirs.create("apl-bk-checkout-other-plugin-");
    await writePipeline(root, [
      "  - label: ':memo: Annotate'",
      "    plugins:",
      "      - test-summary#v1.0: {}",
      "      - docker#v5.13.0: {}",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag unaudited annotation plugins", async () => {
    const root = await tempDirs.create("apl-bk-checkout-junit-");
    await writePipeline(root, [
      "  - label: ':memo: Annotate'",
      "    plugins:",
      "      - junit-annotate#v2.9.0: {}",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("does not flag steps that run commands", async () => {
    const root = await tempDirs.create("apl-bk-checkout-command-");
    await writePipeline(root, [
      "  - label: ':memo: Annotate'",
      "    command: cat results.txt",
      "    plugins:",
      "      - test-summary#v1.0: {}",
    ]);
    expect(await findings(root)).toHaveLength(0);
  });

  test("flags annotation steps inside groups", async () => {
    const root = await tempDirs.create("apl-bk-checkout-group-");
    await writePipeline(root, [
      "  - group: report",
      "    steps:",
      ...TEST_SUMMARY_STEP.map((line) => `    ${line}`),
    ]);
    expect(await findings(root)).toHaveLength(1);
  });
});
