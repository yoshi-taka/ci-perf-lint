import { describe, expect, test } from "bun:test";
import { fixtures } from "./fixtures.ts";
import { memoizedAnalyzeRepository } from "./helpers.ts";

const fixtureSets: { name: string; ruleId: string; fixture: string }[] = [
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
];

describe("cross-platform invariance", () => {
  for (const { name, ruleId, fixture } of fixtureSets) {
    test(name, async () => {
      const fixturePath = fixtures[fixture as keyof typeof fixtures];
      const report = await memoizedAnalyzeRepository({
        cwd: fixturePath,
        targetPath: ".",
        topCount: 100,
        mode: "exploratory",
      });

      const findings = report.findings.filter((f) => f.ruleId === ruleId);
      const expectedPlatforms = [
        ".github/workflows/ci.yml",
        ".buildkite/pipeline.yml",
        ".circleci/config.yml",
        ".gitlab-ci.yml",
      ];

      for (const platform of expectedPlatforms) {
        const finding = findings.find((f) => f.workflow === platform);
        expect(finding, `No finding from ${platform}`).toBeDefined();
      }

      // semantic fields should be identical across platforms (aside from workflow/location/score)
      const semanticFields: (keyof typeof findings[0])[] = [
        "ruleId",
        "severity",
        "confidence",
        "message",
        "why",
        "suggestion",
        "measurementHint",
      ];

      expect(findings.length).toBeGreaterThan(0);
      const first = findings[0]!;
      for (const f of findings) {
        for (const field of semanticFields) {
          expect(f[field], `${field} mismatch in ${f.workflow}`).toEqual(first[field]);
        }
      }
    });
  }
});
