import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  trigger: ["push", "pull_request", "both", "workflow_dispatch"] as const,
  workflowName: ["CI", "docs"] as const,
  hasConcurrency: [true, false] as const,
  hasPathsFilter: [true, false] as const,
  hasTimeoutMinutes: [true, false] as const,
  heavyJob: [true, false] as const,
  jobHasIf: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterRules = new Set([
  "missing-concurrency",
  "missing-timeout-minutes",
  "missing-paths-filter",
  "ungated-heavy-job",
]);

function hasPush(v: string): boolean {
  return v === "push" || v === "both";
}
function hasPR(v: string): boolean {
  return v === "pull_request" || v === "both";
}

function expectedClusterERules(p: Params): Set<string> {
  const expected = new Set<string>();
  const push = hasPush(p.trigger as string);
  const pr = hasPR(p.trigger as string);
  const hasPushOrPR = push || pr;
  const isHeavy = p.workflowName === "CI";

  // missing-concurrency: heavy + push/PR + no concurrency, skip if noPR + push + paths filter
  if (isHeavy && !p.hasConcurrency && hasPushOrPR) {
    if (!(!pr && push && p.hasPathsFilter)) {
      expected.add("missing-concurrency");
    }
  }

  // missing-paths-filter: heavy + (PR or branch-push) + no paths filter
  // Our push generator never sets branches → branch-push = false
  // So only PR triggers can fire this rule in our test
  if (isHeavy && pr && !p.hasPathsFilter) {
    expected.add("missing-paths-filter");
  }

  // missing-timeout-minutes: push/PR + heavy job + no timeout (not matrix/reusable)
  if (hasPushOrPR && p.heavyJob && !p.hasTimeoutMinutes) {
    expected.add("missing-timeout-minutes");
  }

  // ungated-heavy-job: push/PR + heavy job + no if, when repo looks large
  if (hasPushOrPR && p.heavyJob && !p.jobHasIf) {
    expected.add("ungated-heavy-job");
  }

  return expected;
}

function genTrigger(trigger: string, hasPathsFilter: boolean): string[] {
  const lines: string[] = [];
  const add = (event: string) => {
    if (hasPathsFilter) {
      lines.push(`  ${event}:`);
      lines.push("    paths:");
      lines.push('      - "src/**"');
    } else {
      lines.push(`  ${event}:`);
    }
  };
  if (hasPush(trigger)) {
    add("push");
  }
  if (hasPR(trigger)) {
    add("pull_request");
  }
  if (trigger === "workflow_dispatch") {
    lines.push("  workflow_dispatch:");
  }
  return lines;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  out.push(`name: ${p.workflowName}`);
  out.push("on:");
  out.push(...genTrigger(p.trigger as string, p.hasPathsFilter));

  if (p.hasConcurrency) {
    out.push("concurrency:");
    out.push("  group: ${{ github.workflow }}-${{ github.ref }}");
    out.push("  cancel-in-progress: true");
  }

  const jobName = p.heavyJob ? "build" : "lint";
  out.push("jobs:");
  out.push(`  ${jobName}:`);
  out.push("    runs-on: ubuntu-latest");
  if (p.hasTimeoutMinutes) {
    out.push("    timeout-minutes: 10");
  }
  if (p.jobHasIf) {
    out.push("    if: github.ref == 'refs/heads/main'");
  }
  out.push("    steps:");
  out.push("      - uses: actions/checkout@v4");
  out.push(p.heavyJob ? "      - run: npm install && npm run build" : "      - run: echo ok");

  return `${out.join("\n")}\n`;
}

function makeLabel(p: Params): string {
  const l = (b: boolean, t: string, f: string) => (b ? t : f);
  return `${p.trigger} ${l(p.workflowName === "CI", "H", "L")} ${l(p.hasConcurrency, "C", "c")} ${l(p.hasPathsFilter, "F", "f")} ${l(p.hasTimeoutMinutes, "T", "t")} ${l(p.heavyJob, "J", "j")} ${l(p.jobHasIf, "I", "i")}`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apl-pairwise-e-"));
  tempDirs.push(dir);
  const wfDir = path.join(dir, ".github", "workflows");
  await mkdir(wfDir, { recursive: true });

  await writeFile(path.join(wfDir, "test.yml"), generateWorkflowYAML(p));
  await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "test" })}\n`);

  for (let i = 0; i < 9; i++) {
    const d = `name: d${i}\non: push\njobs:\n  j${i}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n`;
    await writeFile(path.join(wfDir, `d${i}.yml`), d);
  }
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
      ...new Set(report.findings.filter((f) => clusterRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster E pairwise: trigger x heavy x concurrency x paths x timeout x job-gating", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(20);
    expect(combinations.length).toBeLessThanOrEqual(80);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash + expected rules`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();

      const exp = expectedClusterERules(p);
      const got = new Set(findings);

      for (const r of exp) {
        expect(got.has(r)).toBe(true);
      }
      for (const r of findings) {
        expect(exp.has(r) || !clusterRules.has(r)).toBe(true);
      }
    });
  }
});
