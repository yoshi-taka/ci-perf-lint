import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

const ruleId = "circleci-node-modules-cache-with-npm-ci";

async function findings(fixture: string, mode: "strict" | "exploratory" = "strict") {
  const report = await memoizedAnalyzeRepository({
    cwd: fixture,
    targetPath: ".",
    topCount: 100,
    mode,
  });
  return report.findings.filter((finding) => finding.ruleId === ruleId);
}

describe("CircleCI node_modules cache followed by npm ci", () => {
  test("reports a wasted node_modules restore", async () => {
    const result = await findings(fixtures.circleciNodeModulesCacheCiLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("warning");
    expect(result[0]?.confidence).toBe("medium");
    expect(result[0]?.message).toContain("npm ci");
    expect(result[0]?.why).toContain("~/.npm");
    expect(result[0]?.location.path).toBe(".circleci/config.yml");
    expect(result[0]?.location.line).toBeGreaterThan(1);
  });

  test("reports npm ci expanded from a reusable command", async () => {
    expect(await findings(fixtures.circleciNodeModulesCacheCommandLike)).toHaveLength(1);
  });

  test("aggregates a shared command used by four jobs into one finding", async () => {
    const result = await findings(fixtures.circleciNodeModulesCacheSharedCommandLike);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('"unit", "lint", "build", "deploy"');
  });

  test("keeps separate findings for different restore_cache locations", async () => {
    const result = await findings(fixtures.circleciNodeModulesCacheTwoLocations);
    expect(result).toHaveLength(2);
    expect(result[0]?.location.line).not.toBe(result[1]?.location.line);
  });

  test("ignores guarded npm ci", async () => {
    expect(await findings(fixtures.circleciNodeModulesCacheGuardOk, "exploratory")).toHaveLength(0);
  });

  test("ignores npm install", async () => {
    expect(await findings(fixtures.circleciNodeModulesCacheInstallOk, "exploratory")).toHaveLength(
      0,
    );
  });

  test("downgrades to suggestion when ~/.npm is also cached", async () => {
    expect(await findings(fixtures.circleciNodeModulesCacheNpmCacheOk)).toHaveLength(0);
    const result = await findings(fixtures.circleciNodeModulesCacheNpmCacheOk, "exploratory");
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("suggestion");
    expect(result[0]?.suggestion).toContain("~/.npm");
  });
});
