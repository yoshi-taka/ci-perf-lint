import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  runsOn: ["ubuntu-latest", "macos-14", "windows-2022", "self-hosted"] as const,
  containerAlpine: ["yes", "no", "none"] as const,
  hasBrewUpdate: [true, false] as const,
  hasXcodeInstall: [true, false] as const,
  hasCDrivePath: [true, false] as const,
  hasTestTool: [true, false] as const,
  hasTestTuning: [true, false] as const,
  extraHeavyStep: [true, false] as const,
  usesReusableWorkflow: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterDRules = new Set([
  "avoid-brew-update-on-hosted-macos",
  "avoid-c-drive-on-windows-runner",
  "avoid-xcode-install-on-hosted-macos",
  "missing-test-worker-tuning-for-standard-runner",
  "consider-slim-over-alpine-for-ci",
]);

function expectedClusterDRules(p: Params): Set<string> {
  const expected = new Set<string>();
  if (p.usesReusableWorkflow) {
    return expected;
  }

  const isMacOS = p.runsOn === "macos-14";
  const isWindows = p.runsOn === "windows-2022";
  const isStandard = p.runsOn !== "self-hosted";
  const noContainer = p.containerAlpine === "none";
  const isHeavy = p.extraHeavyStep || p.hasTestTool;
  const hasAlpine = p.containerAlpine === "yes";

  if (isMacOS && noContainer && p.hasBrewUpdate) {
    expected.add("avoid-brew-update-on-hosted-macos");
  }

  if (isWindows && p.hasCDrivePath) {
    expected.add("avoid-c-drive-on-windows-runner");
  }

  if (isMacOS && noContainer && p.hasXcodeInstall) {
    expected.add("avoid-xcode-install-on-hosted-macos");
  }

  if (isStandard && p.hasTestTool && !p.hasTestTuning) {
    expected.add("missing-test-worker-tuning-for-standard-runner");
  }

  if (hasAlpine && isHeavy) {
    expected.add("consider-slim-over-alpine-for-ci");
  }

  return expected;
}

function makeLabel(p: Params): string {
  const b = (v: boolean, t: string, f: string) => (v ? t : f);
  return `${p.runsOn.slice(0, 2)} ${p.containerAlpine.slice(0, 2)} ${b(p.hasBrewUpdate, "B", "b")}${b(p.hasXcodeInstall, "X", "x")}${b(p.hasCDrivePath, "D", "d")}${b(p.hasTestTool, "T", "t")}${b(p.hasTestTuning, "W", "w")}${b(p.extraHeavyStep, "H", "h")}${b(p.usesReusableWorkflow, "R", "r")}`;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  out.push("name: test");
  out.push("on:");
  out.push("  push:");

  if (p.usesReusableWorkflow) {
    out.push("jobs:");
    out.push("  ci:");
    out.push("    uses: ./.github/workflows/reusable.yml");
    return `${out.join("\n")}\n`;
  }

  out.push("jobs:");
  const jobId = p.extraHeavyStep || p.hasTestTool ? "build" : "sync";
  out.push(`  ${jobId}:`);
  out.push(`    runs-on: ${p.runsOn}`);

  if (p.containerAlpine !== "none") {
    const img = p.containerAlpine === "yes" ? "node:20-alpine" : "node:20";
    out.push(`    container: ${img}`);
  }

  if (p.hasCDrivePath) {
    out.push("    env:");
    out.push("      ROOT: C:\\tools");
  }

  out.push("    steps:");
  if (p.hasBrewUpdate) {
    out.push("      - run: brew update");
  }
  if (p.hasXcodeInstall) {
    out.push("      - run: xcodes install 15.4");
  }
  if (p.hasCDrivePath) {
    out.push('      - run: echo "C:\\path"');
  }
  if (p.hasTestTool) {
    const run = p.hasTestTuning ? "npx jest --maxWorkers=2" : "npx jest --coverage";
    out.push(`      - run: ${run}`);
  }
  if (p.extraHeavyStep) {
    out.push("      - run: npm run build");
  }
  if (
    !p.hasBrewUpdate &&
    !p.hasXcodeInstall &&
    !p.hasCDrivePath &&
    !p.hasTestTool &&
    !p.extraHeavyStep
  ) {
    out.push("      - run: echo ok");
  }

  return `${out.join("\n")}\n`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apl-pairwise-d-"));
  tempDirs.push(dir);
  const wfDir = path.join(dir, ".github", "workflows");
  await mkdir(wfDir, { recursive: true });
  await writeFile(path.join(wfDir, "ci.yml"), generateWorkflowYAML(p));
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "test" })}\n`);
  return dir;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
});

async function runCase(p: Params): Promise<{ findings: string[]; error: string | null }> {
  const dir = await setupFixture(p);
  try {
    const report = await analyzeRepository({
      cwd: process.cwd(),
      targetPath: dir,
      topCount: 100,
      mode: "exploratory",
    });
    const ids = [
      ...new Set(report.findings.filter((f) => clusterDRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster D pairwise: runner-OS × container × brew × xcode × C: × test-tool × tuning × heavy × reusable", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(30);
    expect(combinations.length).toBeLessThanOrEqual(100);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash + expected D rules`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();
      const exp = expectedClusterDRules(p);
      const got = new Set(findings);

      for (const r of exp) {
        expect(got.has(r)).toBe(true);
      }
      for (const r of findings) {
        expect(exp.has(r) || !clusterDRules.has(r)).toBe(true);
      }
    });
  }
});
