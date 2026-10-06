import { afterEach, describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { createTempDirTracker, getWorkflowFocusedFixtureReport } from "./helpers.ts";

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await tempDirs.cleanup();
});

const ruleId = "cuda-torch-install-on-cpu-runner";

async function findRuleFinding(fixture: string, mode: "exploratory" | "strict" = "strict") {
  const report = await getWorkflowFocusedFixtureReport(fixture, {
    targetPath: ".",
    topCount: 20,
    mode,
  });
  return report.findings.find((candidate) => candidate.ruleId === ruleId);
}

describe("cuda-torch-install-on-cpu-runner", () => {
  test("warns when a standard Ubuntu x64 job installs torch without a CPU index", async () => {
    const finding = await findRuleFinding(fixtures.cudaTorchOnCpuRunnerLike);

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('Job "test"');
    expect(finding?.message).toContain("torch");
    expect(finding?.message).toContain("torchvision");
  });

  test("does not warn when the job installs torch from the CPU index", async () => {
    expect(await findRuleFinding(fixtures.cudaTorchOnCpuRunnerOkCpuIndex)).toBeUndefined();
  });

  test("does not warn when the workflow builds against a visible CUDA toolchain", async () => {
    expect(await findRuleFinding(fixtures.cudaTorchOnCpuRunnerOkCudaBuild)).toBeUndefined();
  });

  test("warns when a static Ubuntu-only matrix resolves to standard x64 runners", async () => {
    const finding = await findRuleFinding(fixtures.cudaTorchOnCpuRunnerMatrixLike);

    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain('Job "build"');
  });

  test("does not warn when a matrix mixes Ubuntu with macOS", async () => {
    expect(await findRuleFinding(fixtures.cudaTorchOnCpuRunnerOkMatrixMixed)).toBeUndefined();
  });

  test("does not warn when the job runs on a GPU-labeled runner", async () => {
    expect(await findRuleFinding(fixtures.cudaTorchOnCpuRunnerOkGpuRunner)).toBeUndefined();
  });

  test("does not warn for indirect installs through a requirements file", async () => {
    expect(await findRuleFinding(fixtures.cudaTorchOnCpuRunnerOkRequirements)).toBeUndefined();
  });
});
