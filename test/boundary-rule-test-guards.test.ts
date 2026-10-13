import { afterEach, expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import type { AnalysisWarning } from "../src/types.ts";
import {
  analyzeRepositoryForRule,
  assertRuleTestReport,
  createTempDirTracker,
  writeRepositoryFiles,
} from "./helpers.ts";

const tempDirs = createTempDirTracker();
afterEach(() => tempDirs.cleanup());
const rule = { id: "maven-parallel-not-enabled", severity: "warning" } as const;
const suggestion = { id: "prefer-cdk-asset-build-concurrency", severity: "suggestion" } as const;

test.each([undefined, "strict"] as const)("suggestion tests reject filtered mode: %s", (mode) => {
  expect(() => assertRuleTestReport({ analysisWarnings: [] }, suggestion, mode)).toThrow(
    "requires exploratory mode",
  );
});

test("suggestion tests accept exploratory mode", () => {
  expect(() =>
    assertRuleTestReport({ analysisWarnings: [] }, suggestion, "exploratory"),
  ).not.toThrow();
});

test.each([undefined, "strict", "exploratory"] as const)(
  "warning tests accept mode: %s",
  (mode) => {
    expect(() => assertRuleTestReport({ analysisWarnings: [] }, rule, mode)).not.toThrow();
  },
);

test.each(["gate-skipped", "rule-error", "collector-error"] as const)(
  "rule tests reject incomplete analysis: %s",
  (kind) => {
    const warnings: AnalysisWarning[] = [
      { kind: "scan-warning", source: "unrelated", message: "unrelated telemetry" },
      { kind, source: rule.id, message: "missing fixture evidence" },
    ];
    for (const analysisWarnings of [warnings, [...warnings].reverse()]) {
      expect(() => assertRuleTestReport({ analysisWarnings }, rule, "strict")).toThrow(
        `${kind}: missing fixture evidence`,
      );
    }
  },
);

test("unrelated gate skips do not fail the target's test", () => {
  expect(() =>
    assertRuleTestReport(
      {
        analysisWarnings: [
          { kind: "gate-skipped", source: "another-rule", message: "not applicable" },
        ],
      },
      rule,
    ),
  ).not.toThrow();
});

test("wrapper rejects strict suggestions before accessing a repository", async () => {
  await rejects(
    analyzeRepositoryForRule(
      { cwd: "/nonexistent-rule-test-guard", targetPath: ".", topCount: 100, mode: "strict" },
      suggestion,
    ),
    /requires exploratory mode/,
  );
});

test("missing JVM fixture evidence cannot silently pass an absence assertion", async () => {
  const cwd = await tempDirs.create("apl-rule-guard-missing-");
  await writeRepositoryFiles(cwd, {
    ".github/workflows/ci.yml":
      "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ready\n",
  });
  await rejects(
    analyzeRepositoryForRule({ cwd, targetPath: ".", topCount: 100, mode: "strict" }, rule),
    /gate-skipped/,
  );
});

test("a tuned Maven command with a passed gate can legitimately have no finding", async () => {
  const cwd = await tempDirs.create("apl-rule-guard-tuned-");
  await writeRepositoryFiles(cwd, {
    "pom.xml": "<project><modules><module>app</module></modules></project>",
    ".github/workflows/ci.yml":
      "on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: mvn -T2 verify\n",
  });
  const report = await analyzeRepositoryForRule(
    { cwd, targetPath: ".", topCount: 100, mode: "strict" },
    rule,
  );
  expect(report.findings.some((finding) => finding.ruleId === rule.id)).toBe(false);
});
