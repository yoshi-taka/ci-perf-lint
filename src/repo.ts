import path from "node:path";
import { readTextFile } from "./read-text-file.ts";
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
import {
  collectEmbeddedOxlintImportJsonDiagnostics,
  collectEmbeddedOxlintDiagnosticsByCode,
} from "./repository-diagnostics/embedded-oxlint.ts";
import { collectRepositorySignals } from "./repository-signals.ts";
import type { RepositorySignals } from "./repository-signals-types.ts";
import { evaluateRules, evaluateRulesCoarseToFine } from "./rule-engine.ts";
import { buildWorkflowSemantics } from "./rules/shared/workflow-semantics.ts";
import type { WorkflowSemantics } from "./rules/shared/workflow-semantics.ts";
import { buildRepositoryPrecedentIndex } from "./rules/shared/repository-precedent-index.ts";
import { buildRepositoryPredicateIndex } from "./rules/shared/repository-predicate-index.ts";
import { buildRepositoryFileIndex } from "./rules/shared/repository-file-index.ts";
import { collectRepositoryDiagnostics } from "./repository-diagnostics/index.ts";
import { buildPropagationClusters } from "./repository-diagnostics/repository-propagation.ts";
import { buildRepositoryFeatureIndex } from "./repository-diagnostics/repository-feature-index.ts";
import {
  computeImpliedChecks,
  registerAllRuleMetaForRemediation,
} from "./rules/shared/remediation-checks.ts";
import { allRules } from "./rules/index.ts";
import { PhaseTimer } from "./repo-timer.ts";
import { stderrWarn } from "./stderr-warn.ts";
import { applySeverityPromotion } from "./severity-promotion.ts";
import {
  findingIncludedInMode,
  findingIncludedInScope,
  compareFindings,
  applyLimitedActionsPriority,
} from "./repo-finding-utils.ts";

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

interface ScannedRepo {
  readonly parsedWorkflows: readonly ParsedWorkflowDocument[];
  readonly githubWorkflows: readonly WorkflowDocument[];
  readonly signals: RepositorySignals;
  readonly scanContext: RepositoryScanContext;
  readonly repoRoot: string;
  readonly analysisWarnings: AnalysisWarning[];
  readonly workflowOnly: boolean;
  readonly repositoryOnly: boolean;
  readonly timer: PhaseTimer;
  readonly mode: AuditMode;
  readonly topCount: number;
  readonly inputPath: string;
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
  const cached = parsedWorkflowCache.get(workflowPath);
  if (cached) {
    return cached.parsedWorkflow;
  }

  const source = await readTextFile(workflowPath);

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

async function scanRepo(options: AnalyzeOptions): Promise<ScannedRepo> {
  const timer = new PhaseTimer("analyzeRepository");
  const mode: AuditMode = options.mode ?? "strict";
  let workflowOnly = options.workflowOnly ?? false;
  const repositoryOnly = options.repositoryOnly ?? false;
  const inputPath = path.resolve(options.cwd, options.targetPath);
  const target = await resolveWorkflowTarget(inputPath);
  timer.mark("resolve-target");
  const analysisWarnings: AnalysisWarning[] = [];
  const scanContext = new RepositoryScanContext(target.repoRoot, []);
  scanContext.warmup();
  if (!repositoryOnly && !workflowOnly) {
    const fileCount = await scanContext.estimatedFileCount();
    if (fileCount !== null && fileCount > HUGE_REPO_FILE_THRESHOLD) {
      workflowOnly = true;
      stderrWarn(
        `[repo] Large repository detected (~${(fileCount / 1000).toFixed(0)}k files). Falling back to workflow-only analysis. Use --repository-only to force repository-wide diagnostics.\n`,
      );
    }
  }
  const shouldPrewarmEmbeddedOxlint =
    process.env.CI_PERF_LINT_DISABLE_OXLINT_PREWARM !== "1" &&
    (await scanContext.pathExists(scanContext.resolve("package.json"))) &&
    !workflowOnly;
  if (shouldPrewarmEmbeddedOxlint) {
    void collectEmbeddedOxlintImportJsonDiagnostics(target.repoRoot, undefined, scanContext);
    void collectEmbeddedOxlintDiagnosticsByCode(
      target.repoRoot,
      "oxc(no-barrel-file)",
      undefined,
      scanContext,
    );
  }
  timer.mark(
    shouldPrewarmEmbeddedOxlint ? "embedded-oxlint-prewarm" : "embedded-oxlint-prewarm-skipped",
  );

  const allWorkflowFiles = await collectWorkflowFiles(target);
  timer.mark("list-workflows");

  const parsedWorkflowResults: PromiseSettledResult<ParsedWorkflowDocument>[] = new Array(
    allWorkflowFiles.length,
  );
  const CONCURRENCY = 32;
  for (let i = 0; i < allWorkflowFiles.length; i += CONCURRENCY) {
    const end = Math.min(i + CONCURRENCY, allWorkflowFiles.length);
    const results = await Promise.allSettled(
      allWorkflowFiles
        .slice(i, end)
        .map((workflowPath) => parseWorkflowFile(workflowPath, target.repoRoot)),
    );
    for (let j = 0; j < results.length; j++) {
      parsedWorkflowResults[i + j] = results[j]!;
    }
  }
  timer.mark("parse-workflows");

  const parsedWorkflows: ParsedWorkflowDocument[] = [];
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

  const repositoryAnalysis = await collectRepositorySignals(
    target.repoRoot,
    githubWorkflows,
    scanContext,
  );
  timer.mark("collect-repository-signals");
  analysisWarnings.push(...repositoryAnalysis.warnings);

  return {
    parsedWorkflows,
    githubWorkflows,
    signals: repositoryAnalysis.signals,
    scanContext,
    repoRoot: target.repoRoot,
    analysisWarnings,
    workflowOnly,
    repositoryOnly,
    timer,
    mode,
    topCount: options.topCount,
    inputPath,
  };
}

async function lintRepo(scanned: ScannedRepo): Promise<ReportData> {
  const {
    parsedWorkflows,
    githubWorkflows,
    signals,
    scanContext,
    repoRoot,
    analysisWarnings,
    workflowOnly,
    repositoryOnly,
    timer,
    mode,
    topCount,
    inputPath,
  } = scanned;
  const allFindings: Diagnostic[] = [];
  const ruleFindingCounts = new Map<string, number>();
  const repositoryScopeWorkflowRuleIds = new Set([
    "prefer-oxlint-over-eslint",
    "prefer-lefthook-for-complex-git-hooks",
  ]);

  const wfList = [...parsedWorkflows];

  const precedentIndex = buildRepositoryPrecedentIndex(githubWorkflows);
  const predicateIndex = buildRepositoryPredicateIndex(githubWorkflows);
  const featureIndex = buildRepositoryFeatureIndex(githubWorkflows);
  const fileIndex = buildRepositoryFileIndex(scanContext);
  const ruleContext = {
    repository: signals,
    scanContext,
    precedentIndex,
    fileIndex,
  };

  const semanticsByWorkflow = new Map<ParsedWorkflowDocument, WorkflowSemantics>();
  for (const workflow of wfList) {
    if ("jobs" in workflow && !("kind" in workflow)) {
      semanticsByWorkflow.set(workflow, buildWorkflowSemantics(workflow));
    }
  }

  const [wfFindings, repoDiagnostics] = await Promise.all([
    Promise.all(
      wfList.map((workflow) =>
        evaluateRules(
          workflow,
          {
            ...ruleContext,
            workflowSemantics: semanticsByWorkflow.get(workflow),
          },
          analysisWarnings,
          ruleFindingCounts,
          repositoryOnly
            ? (rule) => repositoryScopeWorkflowRuleIds.has(rule.meta.id)
            : (rule) => !rule.meta.precheck,
        ).then((findings) =>
          findings.filter((finding) =>
            findingIncludedInScope(finding, workflowOnly, repositoryOnly),
          ),
        ),
      ),
    )
      .then((results) => results.flat())
      .then((workflowFindings) =>
        repositoryOnly
          ? workflowFindings
          : evaluateRulesCoarseToFine(
              wfList,
              {
                ...ruleContext,
                workflowSemantics: semanticsByWorkflow as ReadonlyMap<
                  WorkflowDocument,
                  WorkflowSemantics
                >,
              },
              analysisWarnings,
              ruleFindingCounts,
              (rule) => !!rule.meta.precheck,
            )
              .then((findings) =>
                findings.filter((finding) =>
                  findingIncludedInScope(finding, workflowOnly, repositoryOnly),
                ),
              )
              .then((precheckedFindings) => [...workflowFindings, ...precheckedFindings]),
      ),
    workflowOnly
      ? ([] as Diagnostic[])
      : collectRepositoryDiagnostics({
          repoRoot,
          repository: ruleContext.repository,
          workflows: [...githubWorkflows],
          workflowSemantics: semanticsByWorkflow as ReadonlyMap<
            WorkflowDocument,
            WorkflowSemantics
          >,
          warnings: analysisWarnings,
          scanContext,
          fileIndex,
          predicateIndex,
          featureIndex,
        }).then((diags) =>
          diags.filter((finding) => findingIncludedInScope(finding, workflowOnly, repositoryOnly)),
        ),
  ]);

  allFindings.push(...wfFindings, ...repoDiagnostics);
  timer.mark("evaluate-rules-and-diagnostics");

  registerAllRuleMetaForRemediation(allRules);
  const remediationChecks = computeImpliedChecks(allFindings);
  timer.mark("compute-remediation-checks");

  const propagationClusters = await buildPropagationClusters(
    allFindings,
    [...githubWorkflows],
    repoRoot,
  );
  timer.mark("build-propagation-clusters");

  scanContext.clearCaches();

  const promotedFindings = applySeverityPromotion(allFindings, mode);
  const findings = promotedFindings.filter((finding) => findingIncludedInMode(finding, mode));

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

  const workflows: WorkflowSummary[] = wfList.map((workflow) => ({
    path: workflow.relativePath,
    name: workflow.name,
    findings: findingsByWorkflow.get(workflow.relativePath) ?? [],
  }));
  wfList.length = 0;

  const aggregatedFindings = aggregateFindingsWithMembers(findings);
  const topAggregatedFindings = aggregatedFindings.aggregatedFindings.slice(0, topCount);
  const topFindings = findings.slice(0, topCount);
  const fixFirst = uniqueStrings(topAggregatedFindings.map((finding) => finding.suggestion)).slice(
    0,
    topCount,
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
    propagationClusters,
    remediationChecks,
  };
}

export async function analyzeRepository(options: AnalyzeOptions): Promise<ReportData> {
  const scanned = await scanRepo(options);
  return lintRepo(scanned);
}
