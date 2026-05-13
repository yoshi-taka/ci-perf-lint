import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { analyzeRepository } from "../src/repo.ts";
import { generatePairwise, type ParamSpec } from "./pairwise-utils.ts";

const paramsDef = {
  usesDockerBuild: [true, false] as const,
  usesBuildx: [true, false] as const,
  hasCacheFrom: [true, false] as const,
  hasCacheTo: [true, false] as const,
  hasLoadTrue: [true, false] as const,
  usesBuildKitOutputs: [true, false] as const,
};

type Params = { [K in keyof typeof paramsDef]: (typeof paramsDef)[K][number] };

const paramSpecs: ParamSpec[] = Object.entries(paramsDef).map(([name, values]) => ({
  name,
  values: [...values],
}));

const combinations = generatePairwise(paramSpecs);

const clusterGRules = new Set([
  "docker-build-cache-disabled-in-ci",
  "docker-build-without-layer-cache",
  "docker-build-load-true-unnecessary",
]);

function expectedClusterGRules(p: Params): Set<string> {
  const expected = new Set<string>();

  if (!p.usesDockerBuild) {
    return expected;
  }

  if (p.usesBuildx) {
    if (!p.hasCacheFrom && !p.hasCacheTo) {
      expected.add("docker-build-without-layer-cache");
    }
    if (p.hasLoadTrue && !p.usesBuildKitOutputs) {
      expected.add("docker-build-load-true-unnecessary");
    }
  } else {
    if (!p.hasCacheFrom && !p.hasCacheTo) {
      expected.add("docker-build-without-layer-cache");
      expected.add("docker-build-cache-disabled-in-ci");
    }
  }

  return expected;
}

function makeLabel(p: Params): string {
  const b = (v: boolean, t: string, f: string) => (v ? t : f);
  return `${b(p.usesDockerBuild, "D", "d")}${b(p.usesBuildx, "X", "x")}${b(p.hasCacheFrom, "F", "f")}${b(p.hasCacheTo, "T", "t")}${b(p.hasLoadTrue, "L", "l")}${b(p.usesBuildKitOutputs, "K", "k")}`;
}

function generateWorkflowYAML(p: Params): string {
  const out: string[] = [];
  out.push("name: docker");
  out.push("on: push");
  out.push("jobs:");
  out.push("  build:");
  out.push("    runs-on: ubuntu-latest");
  out.push("    steps:");
  out.push("      - uses: actions/checkout@v4");

  if (!p.usesDockerBuild) {
    out.push("      - run: echo 'no docker'");
    return `${out.join("\n")}\n`;
  }

  if (p.usesBuildx) {
    out.push("      - uses: docker/setup-buildx-action@v3");
    out.push("      - uses: docker/build-push-action@v6");
    out.push("        with:");
    if (p.hasCacheFrom) {
      out.push("          cache-from: type=gha");
    }
    if (p.hasCacheTo) {
      out.push("          cache-to: type=gha,mode=max");
    }
    if (p.hasLoadTrue) {
      out.push("          load: true");
    }
    if (p.usesBuildKitOutputs) {
      out.push("          outputs: type=docker,dest=/tmp/image.tar");
    }
  } else {
    out.push("      - run: docker build .");
  }

  return `${out.join("\n")}\n`;
}

const tempDirs: string[] = [];

async function setupFixture(p: Params): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "apl-pairwise-g-"));
  tempDirs.push(dir);
  const wfDir = path.join(dir, ".github", "workflows");
  await mkdir(wfDir, { recursive: true });
  await writeFile(path.join(wfDir, "docker.yml"), generateWorkflowYAML(p));
  await writeFile(path.join(dir, "Dockerfile"), "FROM node:20\nRUN echo 'test'\n");
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
      ...new Set(report.findings.filter((f) => clusterGRules.has(f.ruleId)).map((f) => f.ruleId)),
    ].sort();
    return { findings: ids, error: null };
  } catch (err) {
    return { findings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

describe("cluster G pairwise: docker-build x buildx x cache-from x cache-to x load x buildkit", () => {
  test("pairwise combination count", () => {
    expect(combinations.length).toBeGreaterThanOrEqual(20);
    expect(combinations.length).toBeLessThanOrEqual(80);
  });

  for (const combo of combinations) {
    const p = combo as unknown as Params;
    const label = makeLabel(p);

    test(`[${label}] no crash`, async () => {
      const { findings, error } = await runCase(p);
      expect(error).toBeNull();
      expect(Array.isArray(findings)).toBe(true);
    });
  }
});
