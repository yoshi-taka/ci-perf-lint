import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  fetchDepth: ["absent", "0", "100", "1000", "2000"] as const,
  fetchTags: [true, false] as const,
  hasHistoryDepCmd: [true, false] as const,
  hasOpaqueScript: [true, false] as const,
  mayMutateRepo: [true, false] as const,
  looksReleaseLike: [true, false] as const,
  hasKnownHistoryAction: [true, false] as const,
  usesNxSetShas: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterBRules = new Set([
  "deep-checkout-without-need",
  "deep-checkout-excessive-depth",
]);

function expectedClusterBRules(p: Params): Set<string> {
  const expected = new Set<string>();
  const skips =
    p.hasOpaqueScript || p.mayMutateRepo || p.looksReleaseLike || p.hasKnownHistoryAction;

  if (p.fetchDepth === "0" && !p.fetchTags && !skips && (!p.hasHistoryDepCmd || p.usesNxSetShas)) {
    expected.add("deep-checkout-without-need");
  }

  if (
    (p.fetchDepth === "1000" || p.fetchDepth === "2000") &&
    !p.hasHistoryDepCmd &&
    !skips
  ) {
    expected.add("deep-checkout-excessive-depth");
  }

  return expected;
}

function makeLabel(p: Params): string {
  const d = p.fetchDepth === "absent" ? "X" : p.fetchDepth;
  const t = p.fetchTags ? "T" : "t";
  const h = p.hasHistoryDepCmd ? "H" : "h";
  const op = p.hasOpaqueScript ? "O" : "o";
  const m = p.mayMutateRepo ? "M" : "m";
  const r = p.looksReleaseLike ? "R" : "r";
  const ka = p.hasKnownHistoryAction ? "K" : "k";
  const nx = p.usesNxSetShas ? "N" : "n";
  return `${d} ${t}${h}${op}${m}${r}${ka}${nx}`;
}

function genTriggerDependentCommand(p: Params): string[] {
  const steps: string[] = [];
  if (p.hasHistoryDepCmd) {
    steps.push('      - run: npx commitlint --from HEAD~1');
  }
  if (p.hasOpaqueScript) {
    steps.push('      - run: ./scripts/deploy.sh');
  }
  if (p.mayMutateRepo) {
    steps.push('      - run: git push origin main');
  }
  if (p.hasKnownHistoryAction) {
    steps.push('      - uses: e18e/action-dependency-diff@v1');
  }
  if (p.usesNxSetShas) {
    steps.push('      - uses: nrwl/nx-set-shas@v1');
  }
  return steps;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  const name = p.looksReleaseLike ? "release" : "CI";
  out.push(`name: ${name}`);
  out.push("on:");
  out.push("  push:");
  out.push("jobs:");
  out.push("  build:");
  out.push("    runs-on: ubuntu-latest");
  out.push("    steps:");
  out.push("      - uses: actions/checkout@v4");

  const withItems: string[] = [];
  if (p.fetchDepth !== "absent") {
    withItems.push(`fetch-depth: ${p.fetchDepth}`);
  }
  if (p.fetchTags) {
    withItems.push("fetch-tags: true");
  }

  if (withItems.length > 0) {
    out.push("        with:");
    for (const item of withItems) {
      out.push(`          ${item}`);
    }
  }

  out.push('      - run: echo "hello"');
  out.push(...genTriggerDependentCommand(p));
  return `${out.join("\n")}\n`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apl-pairwise-b-"));
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
      mode: "strict",
    });
    const ids = [
      ...new Set(report.findings.filter((f) => clusterBRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster B pairwise: fetchDepth x history x opaque x mutation x release x knownAction x nxShas", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(30);
    expect(combinations.length).toBeLessThanOrEqual(100);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash + expected B rules`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();

      const exp = expectedClusterBRules(p);
      const got = new Set(findings);

      for (const r of exp) {
        expect(got.has(r)).toBe(true);
      }
      for (const r of findings) {
        expect(exp.has(r) || !clusterBRules.has(r)).toBe(true);
      }
    });
  }
});
