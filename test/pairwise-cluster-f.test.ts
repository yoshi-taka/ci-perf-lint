import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  hasMatrix: [true, false] as const,
  hasShardKeys: [true, false] as const,
  hasTimeout: [true, false] as const,
  isHeavyJob: [true, false] as const,
  hasTestTool: [true, false] as const,
  consumesShardKey: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterFRules = new Set([
  "missing-timeout-minutes",
  "matrix-test-job-without-test-sharding",
]);

function expectedClusterFRules(p: Params): Set<string> {
  const expected = new Set<string>();

  if (p.isHeavyJob && !p.hasTimeout && !p.hasMatrix) {
    expected.add("missing-timeout-minutes");
  }

  if (p.hasMatrix && p.hasShardKeys && p.hasTestTool && !p.consumesShardKey) {
    expected.add("matrix-test-job-without-test-sharding");
  }

  return expected;
}

function makeLabel(p: Params): string {
  const b = (v: boolean, t: string, f: string) => (v ? t : f);
  return `${b(p.hasMatrix, "M", "m")}${b(p.hasShardKeys, "S", "s")}${b(p.hasTimeout, "T", "t")}${b(p.isHeavyJob, "H", "h")}${b(p.hasTestTool, "J", "j")}${b(p.consumesShardKey, "C", "c")}`;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  out.push("name: test");
  out.push("on:");
  out.push("  push:");
  out.push("jobs:");
  const jid = p.isHeavyJob ? "build" : "sync";
  out.push(`  ${jid}:`);
  out.push("    runs-on: ubuntu-latest");

  if (p.hasMatrix) {
    if (p.hasShardKeys) {
      out.push("    strategy:");
      out.push("      matrix:");
      out.push("        shard: [1, 2, 3]");
    } else {
      out.push("    strategy:");
      out.push("      matrix:");
      out.push("        os: [ubuntu, windows]");
    }
  }

  if (p.hasTimeout) { out.push("    timeout-minutes: 10"); }
  out.push("    steps:");
  out.push("      - uses: actions/checkout@v4");

  if (p.hasTestTool) {
    if (p.consumesShardKey && p.hasMatrix && p.hasShardKeys) {
      out.push('      - run: npx jest --shard=${{ matrix.shard }}/3');
    } else {
      out.push('      - run: npx jest');
    }
  }

  if (p.isHeavyJob && !p.hasTestTool) {
    out.push('      - run: npm run build');
  }

  if (!p.hasTestTool && !p.isHeavyJob) {
    out.push('      - run: echo ok');
  }

  return `${out.join("\n")}\n`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apl-pairwise-f-"));
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
      ...new Set(report.findings.filter((f) => clusterFRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster F pairwise: matrix × shard × timeout × heavy × test × consume", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(10);
    expect(combinations.length).toBeLessThanOrEqual(40);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash + expected F rules`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();
      const exp = expectedClusterFRules(p);
      const got = new Set(findings);

      for (const r of exp) {
        expect(got.has(r)).toBe(true);
      }
      for (const r of findings) {
        expect(exp.has(r) || !clusterFRules.has(r)).toBe(true);
      }
    });
  }
});
