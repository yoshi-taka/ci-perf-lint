import { describe, test, afterAll } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";
import {
  normalizeFindings,
  groupFindingsByWorkflow,
  assertEquivalentFindings,
  expectEveryPlatformHasFindings,
  makeEquivalentWorkflowFixtures,
  cleanupFixture,
} from "./cross-platform-invariance-helpers.ts";

interface StaticFixtureCase {
  name: string;
  ruleId: string;
  fixture: keyof typeof fixtures;
}

interface AutoFixtureCase {
  name: string;
  ruleId: string;
  steps: string[];
}

const staticFixtureSets: StaticFixtureCase[] = [
  {
    name: "redundant-npx",
    ruleId: "redundant-npx-or-bootstrap",
    fixture: "crossPlatformRedundantNpx",
  },
  {
    name: "docker-nocache",
    ruleId: "docker-build-cache-disabled-in-ci",
    fixture: "crossPlatformDockerNocache",
  },
  {
    name: "prefer-buildx-build",
    ruleId: "prefer-buildx-build-over-docker-build",
    fixture: "crossPlatformPreferBuildxBuild",
  },
  {
    name: "repeated-install",
    ruleId: "repeated-install-in-same-job",
    fixture: "crossPlatformRepeatedInstall",
  },
  {
    name: "wasteful-npm-global-install",
    ruleId: "wasteful-npm-global-install",
    fixture: "crossPlatformWastefulNpmGlobalInstall",
  },
  {
    name: "unnecessary-npm-global-upgrade",
    ruleId: "unnecessary-npm-global-upgrade-before-npm-install",
    fixture: "crossPlatformUnnecessaryNpmGlobalUpgrade",
  },
  {
    name: "docker-bake-unused",
    ruleId: "docker-bake-file-unused-in-ci",
    fixture: "crossPlatformDockerBakeUnused",
  },
];

const autoFixtureSets: AutoFixtureCase[] = [
  {
    name: "redundant-npx (auto)",
    ruleId: "redundant-npx-or-bootstrap",
    steps: ["npm ci", "npx eslint"],
  },
  {
    name: "docker-build-nocache (auto)",
    ruleId: "docker-build-cache-disabled-in-ci",
    steps: ["docker build --no-cache ."],
  },
  {
    name: "prefer-buildx-build (auto)",
    ruleId: "prefer-buildx-build-over-docker-build",
    steps: ["docker build ."],
  },
  {
    name: "wasteful-npm-global-install (auto)",
    ruleId: "wasteful-npm-global-install",
    steps: ["yarn install", "npm install -g npm"],
  },
  {
    name: "unnecessary-npm-global-upgrade (auto)",
    ruleId: "unnecessary-npm-global-upgrade-before-npm-install",
    steps: ["npm install -g npm", "npm ci"],
  },
];

async function analyzeAndAssert(cwd: string, ruleId: string): Promise<void> {
  const report = await memoizedAnalyzeRepository({
    cwd,
    targetPath: ".",
    topCount: 100,
    mode: "exploratory",
  });

  const findings = report.findings.filter((f) => f.ruleId === ruleId);
  expectEveryPlatformHasFindings(findings, ruleId);

  const byPlatform = groupFindingsByWorkflow(findings);
  const normalized = new Map<string, ReturnType<typeof normalizeFindings>>();
  for (const [platform, pf] of byPlatform) {
    normalized.set(platform, normalizeFindings(pf));
  }
  assertEquivalentFindings(normalized);
}

describe("cross-platform invariance", () => {
  for (const { name, ruleId, fixture } of staticFixtureSets) {
    test(name, async () => {
      await analyzeAndAssert(fixtures[fixture], ruleId);
    });
  }

  const tempDirs: string[] = [];
  afterAll(async () => {
    await Promise.all(tempDirs.map((d) => cleanupFixture(d).catch(() => {})));
  });

  for (const { name, ruleId, steps } of autoFixtureSets) {
    test(name, async () => {
      const dir = await makeEquivalentWorkflowFixtures({
        steps,
        jobName: "test",
      });
      tempDirs.push(dir);
      await analyzeAndAssert(dir, ruleId);
    });
  }
});
