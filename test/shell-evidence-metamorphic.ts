import { expect } from "bun:test";
import type { Diagnostic, ReportData, RuleMeta } from "../src/types.ts";
import { analyzeRepository } from "../src/repo.ts";
import { assertRuleTestReport, writeRepositoryFiles } from "./helpers.ts";

/** Shell data, not double quotes: $() and backticks must stay literal. */
export function shellDataVariants(text: string) {
  const quoted = `'${text.replaceAll("'", "'\\''")}'`;
  return [
    { name: "echo", run: `echo ${quoted}` },
    { name: "printf", run: `printf '%s\\n' ${quoted}` },
    {
      name: "comment",
      run: text
        .split(/\r?\n/)
        .map((line) => `# ${line}`)
        .join("\n"),
    },
  ];
}

export const shellEvidenceNoise = [
  "npm ci",
  "npm run build",
  "docker build --no-cache .",
  "DOCKER_HOST=tcp://other",
  "docker buildx create --name other",
  "triage issue",
  "claude review",
  "git log",
  "release notes",
  "sparse-checkout",
  "mise install",
  "pip install tox tox-uv",
].join("\n");

export interface ShellEvidenceExpectation extends Pick<RuleMeta, "id" | "severity"> {
  scope?: "workflow" | "repository";
  count: number;
  /** Omit when this scenario only checks harmless-log invariance. */
  literalCount?: number;
}

export interface ShellEvidenceScenario {
  name: string;
  command: string;
  build: (run: string) => Record<string, string>;
  expectations: ShellEvidenceExpectation[];
  workflowOnly?: boolean;
  /** Source snippets may change; eligibility/severity/score/why/suggestion must not. */
  messageIncludesSource?: boolean;
  executableSubstitution?: boolean;
}

function matches(finding: Diagnostic, expected: ShellEvidenceExpectation): boolean {
  return (
    finding.ruleId === expected.id &&
    (!expected.scope || (finding.scope ?? "workflow") === expected.scope)
  );
}

export function assertShellEvidenceReport(
  report: Pick<ReportData, "findings" | "analysisWarnings">,
  expectations: ShellEvidenceExpectation[],
  literal = false,
): void {
  // A broken parser/collector, truncated report or filtered suggestion is not a negative control.
  expect(
    report.analysisWarnings.filter((warning) =>
      ["parser-error", "rule-error", "collector-error", "max-findings-hit"].includes(warning.kind),
    ),
  ).toEqual([]);
  for (const expected of expectations) {
    assertRuleTestReport(report, expected, "exploratory");
    expect(report.findings.filter((finding) => matches(finding, expected))).toHaveLength(
      literal ? (expected.literalCount ?? expected.count) : expected.count,
    );
  }
}

export function shellEvidenceProjection(
  report: Pick<ReportData, "findings">,
  scenario: ShellEvidenceScenario,
) {
  return report.findings
    .filter((finding) => scenario.expectations.some((expected) => matches(finding, expected)))
    .map((finding) => ({
      ruleId: finding.ruleId,
      scope: finding.scope ?? "workflow",
      workflow: finding.workflow,
      path: finding.location.path,
      severity: finding.severity,
      confidence: finding.confidence,
      score: finding.score,
      message: scenario.messageIncludesSource ? undefined : finding.message,
      why: finding.why,
      suggestion: finding.suggestion,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export async function runShellEvidenceContract(
  scenario: ShellEvidenceScenario,
  createDirectory: (prefix: string) => Promise<string>,
): Promise<void> {
  // Fresh repositories avoid cached state and preserve the same paths for location projection.
  const scan = async (run: string) => {
    const cwd = await createDirectory("apl-shell-metamorphic-");
    await writeRepositoryFiles(cwd, scenario.build(run));
    return analyzeRepository({
      cwd,
      targetPath: ".",
      mode: "exploratory",
      topCount: 1000,
      repositoryVisibility: "public",
      workflowOnly: scenario.workflowOnly ?? true,
    });
  };
  const baseline = await scan(scenario.command);
  assertShellEvidenceReport(baseline, scenario.expectations);
  expect(scenario.expectations.some((expected) => expected.count > 0)).toBe(true);
  const projection = shellEvidenceProjection(baseline, scenario);

  for (const variant of shellDataVariants(shellEvidenceNoise)) {
    for (const [position, run] of [
      ["before", `${variant.run}\n${scenario.command}`],
      ["after", `${scenario.command}\n${variant.run}`],
    ] as const) {
      try {
        const report = await scan(run);
        assertShellEvidenceReport(report, scenario.expectations);
        expect(shellEvidenceProjection(report, scenario)).toEqual(projection);
      } catch (error) {
        throw new Error(`${scenario.name}: ${variant.name} ${position}\n${run}`, { cause: error });
      }
    }
  }
  if (scenario.expectations.some((expected) => expected.literalCount !== undefined)) {
    for (const variant of shellDataVariants(scenario.command)) {
      assertShellEvidenceReport(await scan(variant.run), scenario.expectations, true);
    }
  }
  if (scenario.executableSubstitution) {
    assertShellEvidenceReport(await scan(`echo "$(${scenario.command})"`), scenario.expectations);
  }
}
