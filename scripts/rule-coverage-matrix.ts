import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { renderReport } from "../src/reporters.ts";
import { memoizedAnalyzeRepository } from "../test/helpers.ts";
import { fixtures } from "../test/fixtures.ts";

const fixtureNames = [
  "sampleRepo",
  "cleanNoFindings",
  "barrelFileLike",
  "deepCheckoutExcessiveLike",
  "dependencyCacheLike",
  "dockerBuildWithoutLayerCacheLike",
  "releaseGuardLike",
  "sparseCheckoutLike",
  "nativeBuildRiskLike",
  "buildkiteTimeoutLike",
  "circleciFullCloneLike",
  "gitlabCiTimeoutLike",
  "agenticWorkflowLike",
  "elixirSecurityAdvisoriesOk",
  "qemuArmLike",
  "blobNoneLike",
  "crossPlatformRedundantNpx",
  "crossPlatformDockerNocache",
] as const;

interface RuleCoverage {
  ruleId: string;
  fixtures: Map<string, number>;
}

async function main() {
  const coverage = new Map<string, RuleCoverage>();

  for (const name of fixtureNames) {
    const fixturePath = fixtures[name as keyof typeof fixtures];
    if (!fixturePath) continue;

    const report = await memoizedAnalyzeRepository({
      cwd: fixturePath,
      targetPath: ".",
      topCount: 200,
      mode: "exploratory",
    });

    for (const finding of report.findings) {
      let rc = coverage.get(finding.ruleId);
      if (!rc) {
        rc = { ruleId: finding.ruleId, fixtures: new Map() };
        coverage.set(finding.ruleId, rc);
      }
      const prev = rc.fixtures.get(name) ?? 0;
      rc.fixtures.set(name, prev + 1);
    }
  }

  const allRuleIds = [...coverage.keys()].sort();
  const allFixtureNames = [...fixtureNames];

  // markdown table
  const header = `| rule | ${allFixtureNames.map((n) => ` ${n} `).join("|")} | count |`;
  const sep = `|------|${allFixtureNames.map(() => "------|").join("")}-------|`;
  console.log(header);
  console.log(sep);

  for (const ruleId of allRuleIds) {
    const rc = coverage.get(ruleId)!;
    const cells = allFixtureNames.map((name) => {
      const count = rc.fixtures.get(name);
      return count ? ` **${count}** ` : " 0 ";
    });
    const totalCount = [...rc.fixtures.values()].reduce((a, b) => a + b, 0);
    console.log(`| ${ruleId} |${cells.join("|")}| ${totalCount} |`);
  }

  // also dump per-rule json for programmatic diffing
  const matrix: Record<string, Record<string, number>> = {};
  for (const ruleId of allRuleIds) {
    const rc = coverage.get(ruleId)!;
    matrix[ruleId] = {};
    for (const [name, count] of rc.fixtures) {
      matrix[ruleId][name] = count;
    }
  }
  const outPath = path.resolve(import.meta.dir, "..", ".rule-coverage-matrix.json");
  await Bun.write(outPath, JSON.stringify(matrix, null, 2));
  console.error(`\nJSON matrix written to ${outPath}`);
}

await main();
