import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildAiHandoff } from "./ai-handoff.ts";
import { parsePipeline, type PipelineDocument } from "./buildkite-workflow.ts";
import { parseGitlabCi, type GitlabCiDocument } from "./gitlab-ci-workflow.ts";
import { parseCircleCi, type CircleCiDocument } from "./circleci-workflow.ts";
import { collectWorkflowFiles, resolveWorkflowTarget } from "./fs.ts";
import { aggregateFindingsWithMembers } from "./reporters.ts";
import { RepositoryScanContext, LruMap } from "./repository-scan-context.ts";
import type {
  AnalysisWarning,
  AuditMode,
  Diagnostic,
  ReportData,
  WorkflowSummary,
} from "./types.ts";
import { parseWorkflow, type WorkflowDocument } from "./workflow.ts";

const buildkitePattern = /(?:^|\/)\.buildkite\//i;
const buildkiteAltPattern = /(?:^|\/)buildkite\//i;
const pipelinePattern = /pipeline\.(ya?ml|json)$/i;
const gitlabCiPattern = /\.gitlab-ci\.(ya?ml)$/i;
const circleCiPattern = /\/\.circleci\/config\.(ya?ml)$/i;
type ParsedWorkflowDocument =
  | WorkflowDocument
  | PipelineDocument
  | GitlabCiDocument
  | CircleCiDocument;

const HUGE_REPO_FILE_THRESHOLD = 80_000;

const parsedWorkflowCache = new LruMap<
  string,
  {
    source: string;
    parsedWorkflow: Promise<ParsedWorkflowDocument>;
  }
>(256);

interface AnalyzeOptions {
  cwd: string;
  targetPath: string;
  topCount: number;
  mode?: AuditMode;
  workflowOnly?: boolean;
  repositoryOnly?: boolean;
}

function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

class PhaseTimer {
  readonly #prefix: string;
  readonly #startedAt: number;
  #lastAt: number;
  readonly #entries: string[] = [];

  constructor(prefix: string) {
    this.#prefix = prefix;
    this.#startedAt = performance.now();
    this.#lastAt = this.#startedAt;
  }

  mark(label: string): void {
    if (!timingsEnabled()) {
      return;
    }

    const now = performance.now();
    this.#entries.push(`${label}=${(now - this.#lastAt).toFixed(1)}ms`);
    this.#lastAt = now;
  }

  flush(): void {
    if (!timingsEnabled()) {
      return;
    }

    const total = (performance.now() - this.#startedAt).toFixed(1);
    process.stderr.write(`[timing] ${this.#prefix} total=${total}ms ${this.#entries.join(" ")}\n`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueWarnings(warnings: AnalysisWarning[]): AnalysisWarning[] {
  const seen = new Set<string>();
  const deduped: AnalysisWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.source}\n${warning.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(warning);
  }

  return deduped;
}

async function parseWorkflowFile(
  workflowPath: string,
  repoRoot: string,
): Promise<ParsedWorkflowDocument> {
  const source = await readFile(workflowPath, "utf8");
  const cached = parsedWorkflowCache.get(workflowPath);
  if (cached?.source === source) {
    return cached.parsedWorkflow;
  }

  // eslint-disable-next-line typescript-eslint/require-await
  const parsedWorkflow = (async () => {
    const isBuildkite =
      buildkitePattern.test(workflowPath) ||
      buildkiteAltPattern.test(workflowPath) ||
      pipelinePattern.test(workflowPath);
    if (isBuildkite) {
      return parsePipeline(workflowPath, repoRoot, source);
    }

    const isGitlabCi = gitlabCiPattern.test(path.basename(workflowPath));
    if (isGitlabCi) {
      return parseGitlabCi(workflowPath, repoRoot, source);
    }

    const isCircleCi = circleCiPattern.test(workflowPath);
    if (isCircleCi) {
      return parseCircleCi(workflowPath, repoRoot, source);
    }

    return parseWorkflow(workflowPath, repoRoot, source);
  })().catch((error) => {
    const current = parsedWorkflowCache.get(workflowPath);
    if (current?.parsedWorkflow === parsedWorkflow) {
      parsedWorkflowCache.delete(workflowPath);
    }
    throw error;
  });

  parsedWorkflowCache.set(workflowPath, { source, parsedWorkflow });
  return parsedWorkflow;
}

const actionsPriorityScoreBonus = 30;
const prioritizedActionsFindingLimit = 3;
const strictFallbackWarningRuleIds = new Set([
  "missing-paths-filter",
  "missing-path-ignore-for-non-code",
]);

export function isActionsFinding(finding: Diagnostic): boolean {
  return finding.scope !== "repository";
}

export function findingIncludedInMode(finding: Diagnostic, mode: AuditMode): boolean {
  return mode === "exploratory" || finding.severity !== "suggestion";
}

export function promoteStrictFallbackSuggestions(findings: Diagnostic[]): Diagnostic[] {
  const hasStrictFinding = findings.some((finding) => finding.severity !== "suggestion");
  if (hasStrictFinding) {
    return findings;
  }

  return findings.map((finding) =>
    finding.severity === "suggestion" && strictFallbackWarningRuleIds.has(finding.ruleId)
      ? {
          ...finding,
          severity: "warning",
        }
      : finding,
  );
}

function findingIncludedInScope(
  finding: Diagnostic,
  workflowOnly: boolean,
  repositoryOnly: boolean,
): boolean {
  if (workflowOnly) {
    return isActionsFinding(finding);
  }

  if (repositoryOnly) {
    return !isActionsFinding(finding);
  }

  return true;
}

export function compareFindings(left: Diagnostic, right: Diagnostic): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (left.workflow < right.workflow) {
    return -1;
  }
  if (left.workflow > right.workflow) {
    return 1;
  }

  if (left.ruleId < right.ruleId) {
    return -1;
  }
  if (left.ruleId > right.ruleId) {
    return 1;
  }

  if (left.location.path < right.location.path) {
    return -1;
  }
  if (left.location.path > right.location.path) {
    return 1;
  }

  if (left.location.line !== right.location.line) {
    return left.location.line - right.location.line;
  }

  if (left.location.column !== right.location.column) {
    return left.location.column - right.location.column;
  }

  if (left.message < right.message) {
    return -1;
  }
  if (left.message > right.message) {
    return 1;
  }
  return 0;
}

export function applyLimitedActionsPriority(findings: Diagnostic[]): Diagnostic[] {
  const prioritizedCandidates: { finding: Diagnostic; index: number }[] = [];

  for (const [index, finding] of findings.entries()) {
    if (!isActionsFinding(finding)) {
      continue;
    }

    prioritizedCandidates.push({ finding, index });
  }

  prioritizedCandidates.sort((left, right) => compareFindings(left.finding, right.finding));

  if (prioritizedCandidates.length > prioritizedActionsFindingLimit) {
    prioritizedCandidates.length = prioritizedActionsFindingLimit;
  }

  const prioritizedIndexes = new Set(prioritizedCandidates.map(({ index }) => index));

  return findings.map((finding, index) =>
    prioritizedIndexes.has(index)
      ? {
          ...finding,
          score: finding.score + actionsPriorityScoreBonus,
        }
      : finding,
  );
}

export async function analyzeRepository(options: AnalyzeOptions): Promise<ReportData> {
  const timer = new PhaseTimer("analyzeRepository");
  const mode: AuditMode = options.mode ?? "strict";
  let workflowOnly = options.workflowOnly ?? false;
  const repositoryOnly = options.repositoryOnly ?? false;
  const inputPath = path.resolve(options.cwd, options.targetPath);
  const target = await resolveWorkflowTarget(inputPath);
  timer.mark("resolve-target");
  const allWorkflowFiles = await collectWorkflowFiles(target);
  timer.mark("list-workflows");
  const analysisWarnings: AnalysisWarning[] = [];
  const scanContext = new RepositoryScanContext(target.repoRoot, []);
  scanContext.warmup();
  if (!repositoryOnly && !workflowOnly) {
    const fileCount = await scanContext.estimatedFileCount();
    if (fileCount !== null && fileCount > HUGE_REPO_FILE_THRESHOLD) {
      workflowOnly = true;
      process.stderr.write(
        `[repo] Large repository detected (~${(fileCount / 1000).toFixed(0)}k files). Falling back to workflow-only analysis. Use --repository-only to force repository-wide diagnostics.\n`,
      );
    }
  }
  if ((await scanContext.pathExists(scanContext.resolve("package.json"))) && !workflowOnly) {
    const { collectEmbeddedOxlintImportJsonDiagnostics } =
      await import("./repository-diagnostics/embedded-oxlint.ts");
    // Prewarm only. Keep report warnings tied to awaited analysis work, not background cache fills.
    void collectEmbeddedOxlintImportJsonDiagnostics(target.repoRoot);
  }
  timer.mark("embedded-oxlint-prewarm");

  const parsedWorkflowResults = await Promise.allSettled(
    allWorkflowFiles.map((workflowPath) => parseWorkflowFile(workflowPath, target.repoRoot)),
  );
  timer.mark("parse-workflows");

  const parsedWorkflows: (
    | WorkflowDocument
    | PipelineDocument
    | GitlabCiDocument
    | CircleCiDocument
  )[] = [];
  for (const [index, result] of parsedWorkflowResults.entries()) {
    if (result.status === "fulfilled") {
      parsedWorkflows.push(result.value);
    } else {
      const detail = result.reason instanceof Error ? result.reason.message : String(result.reason);
      analysisWarnings.push({
        source: allWorkflowFiles[index] ?? "unknown",
        message: `Failed to parse workflow: ${detail}`,
      });
    }
  }

  const githubWorkflows = parsedWorkflows.filter(
    (w): w is WorkflowDocument => "jobs" in w && !("kind" in w),
  );

  const { collectRepositorySignals } = await import("./repository-signals.ts");
  const repositoryAnalysis = await collectRepositorySignals(
    target.repoRoot,
    githubWorkflows,
    scanContext,
  );
  timer.mark("collect-repository-signals");
  analysisWarnings.push(...repositoryAnalysis.warnings);
  const ruleContext = {
    repository: repositoryAnalysis.signals,
  };

  const allFindings: Diagnostic[] = [];

  const { evaluateRules } = await import("./rule-engine.ts");
  for (const workflow of parsedWorkflows) {
    const workflowFindings = (await evaluateRules(workflow, ruleContext, analysisWarnings)).filter(
      (finding) => findingIncludedInScope(finding, workflowOnly, repositoryOnly),
    );

    for (const finding of workflowFindings) {
      allFindings.push(finding);
    }
  }
  timer.mark("evaluate-workflow-rules");

  if (!workflowOnly) {
    const { collectRepositoryDiagnostics } = await import("./repository-diagnostics/index.ts");
    const repositoryDiagnostics = await collectRepositoryDiagnostics({
      repoRoot: target.repoRoot,
      repository: ruleContext.repository,
      workflows: githubWorkflows,
      warnings: analysisWarnings,
      scanContext,
    });
    for (const finding of repositoryDiagnostics) {
      if (findingIncludedInScope(finding, workflowOnly, repositoryOnly)) {
        allFindings.push(finding);
      }
    }
  }
  timer.mark("collect-repository-diagnostics");

  scanContext.clearCaches();

  const findings =
    mode === "strict"
      ? promoteStrictFallbackSuggestions(allFindings).filter((finding) =>
          findingIncludedInMode(finding, mode),
        )
      : allFindings;

  findings.splice(0, findings.length, ...applyLimitedActionsPriority(findings));
  findings.sort(compareFindings);

  const findingsByWorkflow = new Map<string, Diagnostic[]>();

  for (const finding of findings) {
    const workflowFindings = findingsByWorkflow.get(finding.workflow);
    if (workflowFindings) {
      workflowFindings.push(finding);
    } else {
      findingsByWorkflow.set(finding.workflow, [finding]);
    }
  }

  const workflows: WorkflowSummary[] = parsedWorkflows.map((workflow) => ({
    path: workflow.relativePath,
    name: workflow.name,
    findings: findingsByWorkflow.get(workflow.relativePath) ?? [],
  }));
  parsedWorkflows.length = 0;

  const aggregatedFindings = aggregateFindingsWithMembers(findings);
  const topAggregatedFindings = aggregatedFindings.aggregatedFindings.slice(0, options.topCount);
  const topFindings = findings.slice(0, options.topCount);
  const fixFirst = uniqueStrings(topAggregatedFindings.map((finding) => finding.suggestion)).slice(
    0,
    options.topCount,
  );
  const aiHandoff = buildAiHandoff(topAggregatedFindings);
  timer.mark("aggregate-report");
  timer.flush();

  return {
    targetPath: inputPath,
    workflowCount: workflows.length,
    scannedAt: new Date().toISOString(),
    topFindings,
    topAggregatedFindings,
    findings,
    workflows,
    fixFirst,
    aiHandoff,
    analysisWarnings: uniqueWarnings(analysisWarnings),
  };
}
