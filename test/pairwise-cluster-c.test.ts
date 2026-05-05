import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  setupAction: ["none", "setup-node", "setup-python"] as const,
  installFamily: ["none", "npm", "pip"] as const,
  setupActionCaches: [true, false] as const,
  hasManualCache: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterCRules = new Set([
  "missing-dependency-cache",
  "redundant-manual-cache-with-setup-action",
]);

function familiesMatch(action: string, family: string): boolean {
  return (
    (action === "setup-node" && family === "npm") ||
    (action === "setup-python" && family === "pip")
  );
}

function expectedClusterCRules(p: Params): Set<string> {
  const expected = new Set<string>();
  if (p.setupAction === "none") { return expected; }

  const compatible = familiesMatch(p.setupAction, p.installFamily);

  if (compatible && p.installFamily !== "none") {
    const isCached = p.setupActionCaches || p.hasManualCache;
    if (!isCached) {
      expected.add("missing-dependency-cache");
    }
  }

  if (p.setupActionCaches && p.hasManualCache) {
    const actionCaches = p.setupAction === "setup-node" ? "npm" : "pip";
    const manualCaches = p.installFamily === "pip" ? "pip" : "npm";
    if (actionCaches === manualCaches) {
      expected.add("redundant-manual-cache-with-setup-action");
    }
  }

  return expected;
}

function makeLabel(p: Params): string {
  const sa = p.setupAction === "none" ? "N" : p.setupAction.slice(6, 10);
  const fm = p.installFamily === "none" ? "n" : p.installFamily[0]!;
  const sc = p.setupActionCaches ? "C" : "c";
  const mc = p.hasManualCache ? "M" : "m";
  return `${sa} ${fm} ${sc}${mc}`;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  out.push("name: test");
  out.push("on:");
  out.push("  push:");
  out.push("jobs:");
  out.push("  ci:");
  out.push("    runs-on: ubuntu-latest");
  out.push("    steps:");
  out.push("      - uses: actions/checkout@v4");

  if (p.setupAction !== "none") {
    const version = p.setupAction === "setup-node" ? "20" : "3.12";
    out.push(`      - uses: actions/${p.setupAction}@v4`);
    out.push("        with:");
    out.push(`          ${p.setupAction === "setup-node" ? "node-version" : "python-version"}: ${version}`);
    if (p.setupActionCaches) {
      const cf = p.setupAction === "setup-node" ? "npm" : "pip";
      out.push(`          cache: ${cf}`);
    }
  }

  if (p.installFamily === "npm") {
    out.push('      - run: npm ci');
  } else if (p.installFamily === "pip") {
    out.push('      - run: pip install -r requirements.txt');
  }

  if (p.hasManualCache) {
    const cpath = p.installFamily === "pip" ? "~/.cache/pip" : "~/.npm";
    const key = p.installFamily === "pip" ? "pip" : "npm";
    out.push("      - uses: actions/cache@v4");
    out.push("        with:");
    out.push(`          path: ${cpath}`);
    out.push(`          key: ${key}-\${{ hashFiles('**/lockfiles') }}`);
  }

  if (p.setupAction === "none" && p.installFamily === "none" && !p.hasManualCache) {
    out.push('      - run: echo ok');
  }

  return `${out.join("\n")}\n`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apl-pairwise-c-"));
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
      ...new Set(report.findings.filter((f) => clusterCRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster C pairwise: setup-action × install-family × action-cache × manual-cache", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(10);
    expect(combinations.length).toBeLessThanOrEqual(50);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash + expected C rules`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();
      const exp = expectedClusterCRules(p);
      const got = new Set(findings);

      for (const r of exp) {
        expect(got.has(r)).toBe(true);
      }
      for (const r of findings) {
        expect(exp.has(r) || !clusterCRules.has(r)).toBe(true);
      }
    });
  }
});
