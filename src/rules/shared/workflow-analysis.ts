import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { PipelineDocument } from "../../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import { detectLintTool, detectPythonTool } from "./tools.ts";
import { getWorkflowStepText, getLoweredWorkflowStepText } from "./workflow-step-text.ts";

const dockerBuildxBakePattern = /\bdocker\s+buildx\s+bake\b|\bdocker-buildx\s+bake\b/i;
const heavyStepSignalPattern =
  /(npm|pnpm|yarn|bun|pip|poetry|\buv\b|go test|cargo test|pytest|vitest|jest|eslint|biome|oxlint|\bclaude\b|\bcodex\b|\bgemini\b|\bbuild\b)/;
const directHeavySignalPattern =
  /(npm|pnpm|yarn|bun|pip|poetry|\buv\b|go test|cargo test|pytest|vitest|jest|eslint|biome|oxlint|\bclaude\b|\bcodex\b|\bgemini\b|integration|e2e|benchmark|bench|\bbuild\b|\btest\b)/;
const historyDependentCommandPattern =
  /(git fetch|git pull|git rebase|git merge|git push|git describe|git diff|git log|git rev-list|git tag|commitlint|semantic-release|lerna changed|nx affected|turbo run|get-release-version|release notes|changelog|previous tag|release-it|changeset)/i;
const opaqueRepoScriptExecutionPattern =
  /(?:^|\s)(?:\.\/(?:script|scripts|dev|tools|bin|hack|tasks)\/\S+|(?:script|scripts|dev|tools|bin|hack|tasks)\/\S+|(?:bash|sh)\s+(?:\.\/)?(?:script|scripts|dev|tools|bin|hack|tasks)\/\S+|(?:node|bun|python|python3)\s+(?:\.\/)?(?:script|scripts|dev|tools|bin|hack|tasks)\/\S+)/i;
const metaCheckLikePattern =
  /(danger|commitlint|label|triage|stale|no-response|markdown-link-check|issue|pull request|pull-request)/;
const agenticLikePattern =
  /(claude|codex|openai|anthropic|gemini|google-gemini|gemini-cli|ai agent|agentic|review bot|autofix|code review)/;
const heavyJobIdPattern = /(build|test|lint|e2e|integration|release|deploy)/;
const metaCheckIdPattern = /\b(danger|commitlint|label|triage|stale|no-response|meta)\b/;
const agenticIdPattern = /\b(ai|agent|claude|codex|openai|anthropic|gemini|review|autofix)\b/;
const heavyWorkflowNamePattern = /\b(ci|test|build|lint|e2e|integration|release|deploy)\b/;
const metaCheckWorkflowNamePattern =
  /\b(danger|commitlint|label|triage|stale|no response|no-response|meta|policy validation)\b/;
const agenticWorkflowNamePattern =
  /\b(ai|agent|claude|codex|openai|anthropic|gemini|review bot|autofix)\b/;

interface JobAnalysis {
  checkoutStep?: WorkflowStep;
  hasSetupBunStep: boolean;
  hasSetupPnpmStep: boolean;
  hasSetupUvStep: boolean;
  hasBuildxBake: boolean;
  isHeavyJob: boolean;
  hasDirectHeavySignals: boolean;
  hasHistoryDependentCommand: boolean;
  hasOpaqueRepoScriptExecution: boolean;
  looksMetaCheckLike: boolean;
  looksAgenticLike: boolean;
  lintTools: ReadonlySet<string>;
  pythonTools: ReadonlySet<string>;
  loweredStepTextBlob: string;
}

interface WorkflowAnalysis {
  isHeavyWorkflow: boolean;
  hasConcurrency: boolean;
  looksMetaCheckLike: boolean;
  looksAgenticLike: boolean;
  lintTools: ReadonlySet<string>;
  pythonTools: ReadonlySet<string>;
  loweredStepTextBlob: string;
}

const jobAnalysisCache = new WeakMap<WorkflowJob, JobAnalysis>();
const workflowAnalysisCache = new WeakMap<WorkflowDocument, WorkflowAnalysis>();

const emptyWorkflowAnalysis: WorkflowAnalysis = {
  isHeavyWorkflow: false,
  hasConcurrency: false,
  looksMetaCheckLike: false,
  looksAgenticLike: false,
  lintTools: new Set(),
  pythonTools: new Set(),
  loweredStepTextBlob: "",
};

function usesSetupAction(stepUses: string | undefined, prefix: string): boolean {
  return typeof stepUses === "string" && stepUses.toLowerCase().startsWith(prefix);
}

export function hasCheckoutStep(job: WorkflowJob): boolean {
  return getJobAnalysis(job).checkoutStep !== undefined;
}

export function getCheckoutStep(job: WorkflowJob): WorkflowStep | undefined {
  return getJobAnalysis(job).checkoutStep;
}

export function hasSetupBunStep(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasSetupBunStep;
}

export function hasSetupPnpmStep(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasSetupPnpmStep;
}

export function hasSetupUvStep(job: WorkflowJob): boolean {
  return getJobAnalysis(job).hasSetupUvStep;
}

export function getJobAnalysis(job: WorkflowJob): JobAnalysis {
  const cached = jobAnalysisCache.get(job);
  if (cached) {
    return cached;
  }

  let checkoutStep: WorkflowStep | undefined;
  let foundSetupBunStep = false;
  let foundSetupPnpmStep = false;
  let foundSetupUvStep = false;
  let hasBuildxBake = false;
  let hasHeavyStepSignal = false;
  let hasDirectHeavySignals = false;
  let hasHistoryDependentCommand = false;
  let hasOpaqueRepoScriptExecution = false;
  let looksMetaCheckLike = false;
  let looksAgenticLike = false;
  const lintTools = new Set<string>();
  const pythonTools = new Set<string>();
  const loweredStepTexts: string[] = [];

  for (const step of job.steps) {
    if (!checkoutStep && usesSetupAction(step.uses, "actions/checkout@")) {
      checkoutStep = step;
    }

    foundSetupBunStep ||= usesSetupAction(step.uses, "oven-sh/setup-bun@");
    foundSetupPnpmStep ||= usesSetupAction(step.uses, "pnpm/action-setup@");
    foundSetupUvStep ||= usesSetupAction(step.uses, "astral-sh/setup-uv@");

    const loweredStepText = getLoweredWorkflowStepText(step);
    loweredStepTexts.push(loweredStepText);
    const stepText = getWorkflowStepText(step);
    const loweredRunNameText = `${step.name ?? ""} ${step.run ?? ""}`.toLowerCase();
    const run = step.run ?? "";
    const lintTool = detectLintTool(step);
    const pythonTool = detectPythonTool(step);

    if (lintTool) {
      lintTools.add(lintTool);
    }

    if (pythonTool) {
      pythonTools.add(pythonTool);
    }

    hasBuildxBake ||= dockerBuildxBakePattern.test(run);
    hasHeavyStepSignal ||= heavyStepSignalPattern.test(loweredStepText);
    hasDirectHeavySignals ||= directHeavySignalPattern.test(loweredRunNameText);
    hasHistoryDependentCommand ||= historyDependentCommandPattern.test(stepText);
    hasOpaqueRepoScriptExecution ||= opaqueRepoScriptExecutionPattern.test(run);
    looksMetaCheckLike ||= metaCheckLikePattern.test(loweredStepText);
    looksAgenticLike ||= agenticLikePattern.test(loweredStepText);
  }

  const loweredId = job.id.toLowerCase();
  const analysis = {
    checkoutStep,
    hasSetupBunStep: foundSetupBunStep,
    hasSetupPnpmStep: foundSetupPnpmStep,
    hasSetupUvStep: foundSetupUvStep,
    hasBuildxBake,
    isHeavyJob: heavyJobIdPattern.test(loweredId) || hasHeavyStepSignal,
    hasDirectHeavySignals,
    hasHistoryDependentCommand,
    hasOpaqueRepoScriptExecution,
    looksMetaCheckLike: metaCheckIdPattern.test(loweredId) || looksMetaCheckLike,
    looksAgenticLike: agenticIdPattern.test(loweredId) || looksAgenticLike,
    lintTools,
    pythonTools,
    loweredStepTextBlob: loweredStepTexts.join("\n"),
  } satisfies JobAnalysis;
  jobAnalysisCache.set(job, analysis);
  return analysis;
}

export function getWorkflowAnalysis(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): WorkflowAnalysis {
  if ("steps" in workflow && !("jobs" in workflow)) {
    return emptyWorkflowAnalysis;
  }

  if ("kind" in workflow) {
    return emptyWorkflowAnalysis;
  }

  const wf = workflow as WorkflowDocument;
  const cached = workflowAnalysisCache.get(wf);
  if (cached) {
    return cached;
  }

  const loweredName = wf.name?.toLowerCase() ?? "";
  let hasJobConcurrency = false;
  let hasHeavyJob = false;
  let hasMetaCheckJob = false;
  let hasAgenticJob = false;
  const lintTools = new Set<string>();
  const pythonTools = new Set<string>();
  const loweredStepTexts: string[] = [];

  for (const job of wf.jobs) {
    const jobAnalysis = getJobAnalysis(job);
    hasJobConcurrency ||= Boolean(job.concurrencyNode);
    hasHeavyJob ||= jobAnalysis.isHeavyJob;
    hasMetaCheckJob ||= jobAnalysis.looksMetaCheckLike;
    hasAgenticJob ||= jobAnalysis.looksAgenticLike;
    for (const lintTool of jobAnalysis.lintTools) {
      lintTools.add(lintTool);
    }
    for (const pythonTool of jobAnalysis.pythonTools) {
      pythonTools.add(pythonTool);
    }
    loweredStepTexts.push(jobAnalysis.loweredStepTextBlob);
  }

  const analysis = {
    isHeavyWorkflow: heavyWorkflowNamePattern.test(loweredName) || hasHeavyJob,
    hasConcurrency: Boolean(wf.concurrencyNode) || hasJobConcurrency,
    looksMetaCheckLike: metaCheckWorkflowNamePattern.test(loweredName) || hasMetaCheckJob,
    looksAgenticLike: agenticWorkflowNamePattern.test(loweredName) || hasAgenticJob,
    lintTools,
    pythonTools,
    loweredStepTextBlob: loweredStepTexts.join("\n"),
  } satisfies WorkflowAnalysis;
  workflowAnalysisCache.set(wf, analysis);
  return analysis;
}

function regexMatches(text: string, matcher: RegExp): boolean {
  matcher.lastIndex = 0;
  return matcher.test(text);
}

export function workflowUsesLintTool(workflow: WorkflowDocument, tool: string): boolean {
  return getWorkflowAnalysis(workflow).lintTools.has(tool);
}

export function workflowUsesPythonTool(workflow: WorkflowDocument, tool: string): boolean {
  return getWorkflowAnalysis(workflow).pythonTools.has(tool);
}

export function workflowStepTextMatches(workflow: WorkflowDocument, matcher: RegExp): boolean {
  return regexMatches(getWorkflowAnalysis(workflow).loweredStepTextBlob, matcher);
}
