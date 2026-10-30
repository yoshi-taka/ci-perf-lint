import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeRepositoryForRule, createTempDirTracker } from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());

async function analyzeConfig(config: unknown, ruleId: string) {
  const root = await tempDirs.create("apl-vercel-ci-");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "vercel-ci", scripts: { build: "echo built" } }),
  );
  const source = typeof config === "string" ? config : JSON.stringify(config, null, 2);
  await writeFile(path.join(root, "vercel.json"), source);
  const report = await analyzeRepositoryForRule(
    { cwd: root, targetPath: ".", mode: "strict", topCount: 100 },
    { id: ruleId, severity: "warning" },
  );
  return {
    source,
    findings: report.findings.filter(
      (finding) => finding.ruleId === ruleId && finding.location.path === "vercel.json",
    ),
  };
}

describe("Vercel CI bootstrapping commands", () => {
  test.each([
    ["pip install requests", "prefer-uv-pip-over-pip"],
    ["make build", "missing-make-j-flag"],
    ["npm run build", "prefer-node-run-over-npm-run"],
  ])("applies existing diagnostics to %s", async (command, ruleId) => {
    const { findings } = await analyzeConfig(
      { ci: { bootstrapping: { installCommand: command, installEnv: {} } } },
      ruleId,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("ci.bootstrapping.installCommand");
  });

  test("locates the nested command independently of the deployment command", async () => {
    const { source, findings } = await analyzeConfig(
      {
        installCommand: "echo deployment install",
        ci: {
          bootstrapping: {
            installCommand: "pip install requests",
            installEnv: {},
          },
        },
      },
      "prefer-uv-pip-over-pip",
    );
    expect(findings).toHaveLength(1);
    const line =
      source.split("\n").findIndex((entry) => entry.includes("pip install requests")) + 1;
    expect(findings[0]?.location.line).toBe(line);
    expect(findings[0]?.location.column).toBe(7);
  });

  test("keeps deployment and CI command findings separate", async () => {
    const { findings } = await analyzeConfig(
      {
        ci: { bootstrapping: { installCommand: "pip install requests", installEnv: {} } },
        installCommand: "pip install flask",
      },
      "prefer-uv-pip-over-pip",
    );
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((finding) => finding.location.line)).size).toBe(2);
  });

  test.each(["make -j2 build", "MAKEFLAGS=-j2 make build", "echo make build"])(
    "does not flag an already tuned or unexecuted command: %s",
    async (command) => {
      const { findings } = await analyzeConfig(
        { ci: { bootstrapping: { installCommand: command, installEnv: {} } } },
        "missing-make-j-flag",
      );
      expect(findings).toEqual([]);
    },
  );

  test("respects bootstrap installEnv without leaking it into deployment commands", async () => {
    const { findings } = await analyzeConfig(
      {
        buildCommand: "make build",
        ci: { bootstrapping: { installCommand: "make build", installEnv: { MAKEFLAGS: "-j2" } } },
      },
      "missing-make-j-flag",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("vercel.json buildCommand");
  });

  test("does not use deployment installCommand as CI bootstrap evidence", async () => {
    const { findings } = await analyzeConfig(
      {
        installCommand: "npm install",
        ci: { bootstrapping: { installCommand: "npx eslint .", installEnv: {} } },
      },
      "redundant-npx-or-bootstrap",
    );
    expect(findings).toEqual([]);
  });

  test.each([
    { ci: null },
    { ci: [] },
    { ci: "invalid" },
    { ci: { bootstrapping: [] } },
    { ci: { bootstrapping: { installCommand: 42 } } },
  ])("ignores malformed CI configuration: %j", async ({ ci }) => {
    const { findings } = await analyzeConfig({ ci }, "prefer-uv-pip-over-pip");
    expect(findings).toEqual([]);
  });

  test("keeps existing diagnostics for projects without CI configuration", async () => {
    const { findings } = await analyzeConfig(
      { buildCommand: "pip install requests" },
      "prefer-uv-pip-over-pip",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("vercel.json buildCommand");
  });
});
