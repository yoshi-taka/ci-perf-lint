import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect } from "bun:test";
import type { Diagnostic, Severity, Confidence } from "../src/types.ts";

export interface CrossPlatformFixtureConfig {
  jobName?: string;
  steps: string[];
  dockerImage?: string;
}

export interface NormalizedFinding {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  docsPath: string;
  message: string;
  why: string;
  suggestion: string;
  measurementHint: string;
  aiHandoff: string;
}

function normalizeText(text: string): string {
  return text
    .replace(/`[^`]+`/g, "<step>")
    .replace(
      /(?:\.github\/workflows\/[\w.-]+|\.buildkite\/pipeline\.yml|\.circleci\/config\.yml|\.gitlab-ci\.yml)/g,
      "<workflow>",
    )
    .replace(/#(\d+)/g, "#<idx>")
    .replace(/\b(?:S|s)tep\s+"[^"]+"/g, 'step "<step>"')
    .replace(/"\(unnamed\)"/g, '"<step>"');
}

export function normalizeFindings(findings: Diagnostic[]): NormalizedFinding[] {
  return findings.map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity,
    confidence: f.confidence,
    docsPath: f.docsPath,
    message: normalizeText(f.message),
    why: normalizeText(f.why),
    suggestion: normalizeText(f.suggestion),
    measurementHint: normalizeText(f.measurementHint),
    aiHandoff: normalizeText(f.aiHandoff),
  }));
}

export function groupFindingsByWorkflow(findings: Diagnostic[]): Map<string, Diagnostic[]> {
  const groups = new Map<string, Diagnostic[]>();
  for (const f of findings) {
    const existing = groups.get(f.workflow);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(f.workflow, [f]);
    }
  }
  return groups;
}

const EXPECTED_PLATFORMS = [
  ".github/workflows/ci.yml",
  ".buildkite/pipeline.yml",
  ".circleci/config.yml",
  ".gitlab-ci.yml",
] as const;

function sortFindings(arr: NormalizedFinding[]): NormalizedFinding[] {
  return [...arr].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function assertEquivalentFindings(
  findingsByPlatform: Map<string, NormalizedFinding[]>,
): void {
  const entries = [...findingsByPlatform.entries()];

  expect(entries.length).toBeGreaterThan(0);
  if (entries.length === 0) {
    return;
  }

  const [firstPlatform, firstFindings] = entries[0]!;
  const sortedFirst = sortFindings(firstFindings);

  for (const [platform, findings] of entries.slice(1)) {
    const sorted = sortFindings(findings);

    expect(
      sorted.length,
      `finding count mismatch: ${firstPlatform}=${sortedFirst.length}, ${platform}=${sorted.length}`,
    ).toEqual(sortedFirst.length);

    for (let i = 0; i < sortedFirst.length; i++) {
      const expected = sortedFirst[i]!;
      const actual = sorted[i];

      expect(
        actual,
        `missing finding #${i} on ${platform}: expected ruleId=${expected.ruleId}`,
      ).toBeDefined();

      expect(actual!.ruleId, `ruleId mismatch on ${platform}`).toEqual(expected.ruleId);
      expect(actual!.severity, `severity mismatch for ${expected.ruleId} on ${platform}`).toEqual(
        expected.severity,
      );
      expect(
        actual!.confidence,
        `confidence mismatch for ${expected.ruleId} on ${platform}`,
      ).toEqual(expected.confidence);
      expect(actual!.docsPath, `docsPath mismatch for ${expected.ruleId} on ${platform}`).toEqual(
        expected.docsPath,
      );
      expect(actual!.message, `message mismatch for ${expected.ruleId} on ${platform}`).toEqual(
        expected.message,
      );
      expect(actual!.why, `why mismatch for ${expected.ruleId} on ${platform}`).toEqual(
        expected.why,
      );
      expect(
        actual!.suggestion,
        `suggestion mismatch for ${expected.ruleId} on ${platform}`,
      ).toEqual(expected.suggestion);
      expect(
        actual!.measurementHint,
        `measurementHint mismatch for ${expected.ruleId} on ${platform}`,
      ).toEqual(expected.measurementHint);
      expect(actual!.aiHandoff, `aiHandoff mismatch for ${expected.ruleId} on ${platform}`).toEqual(
        expected.aiHandoff,
      );
    }
  }
}

export function expectEveryPlatformHasFindings(findings: Diagnostic[], ruleId: string): void {
  for (const platform of EXPECTED_PLATFORMS) {
    const finding = findings.find((f) => f.ruleId === ruleId && f.workflow === platform);
    expect(finding, `No finding for rule "${ruleId}" from ${platform}`).toBeDefined();
  }
}

export async function makeEquivalentWorkflowFixtures(
  config: CrossPlatformFixtureConfig,
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cross-platform-invariant-"));
  const dockerImage = config.dockerImage ?? "node:22";
  const jobName = config.jobName ?? "ci";
  const steps = config.steps;

  const ghDir = path.join(dir, ".github", "workflows");
  await mkdir(ghDir, { recursive: true });
  const ghSteps = steps.map((cmd) => `      - run: ${cmd}`).join("\n");
  await writeFile(
    path.join(ghDir, "ci.yml"),
    [
      "name: ci",
      "on: push",
      "jobs:",
      `  ${jobName}:`,
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      ghSteps,
      "",
    ].join("\n"),
  );

  const bkDir = path.join(dir, ".buildkite");
  await mkdir(bkDir, { recursive: true });
  const bkSteps = steps.map((cmd) => `  - label: "${jobName}"\n    command: ${cmd}`).join("\n");
  await writeFile(path.join(bkDir, "pipeline.yml"), `steps:\n${bkSteps}\n`);

  const ccDir = path.join(dir, ".circleci");
  await mkdir(ccDir, { recursive: true });
  const ccSteps = steps.map((cmd) => `      - run: ${cmd}`).join("\n");
  await writeFile(
    path.join(ccDir, "config.yml"),
    [
      "version: 2.1",
      "jobs:",
      `  ${jobName}:`,
      "    docker:",
      `      - image: ${dockerImage}`,
      "    steps:",
      "      - checkout",
      ccSteps,
      "workflows:",
      "  version: 2",
      "  all:",
      "    jobs:",
      `      - ${jobName}`,
      "",
    ].join("\n"),
  );

  await writeFile(
    path.join(dir, ".gitlab-ci.yml"),
    [
      `${jobName}:`,
      `  image: ${dockerImage}`,
      "  script:",
      ...steps.map((cmd) => `    - ${cmd}`),
      "",
    ].join("\n"),
  );

  return dir;
}

export async function cleanupFixture(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
