import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import type { PipelineDocument } from "../../buildkite-workflow.ts";
import type { GitlabCiDocument } from "../../gitlab-ci-workflow.ts";
import type { CircleCiDocument } from "../../circleci-workflow.ts";
import type { SetupActionKind } from "./tools.ts";
import type { TriggerFacts } from "./trigger-facts.ts";
import type { RunsOnSpec } from "./runs-on-facts.ts";
import type { EvidenceStrength, HeavyEvidence, HeavyWorkflowEvidence } from "./evidence.ts";
import { combineStrength } from "./evidence.ts";
import { getTriggerFacts } from "./trigger-facts.ts";
import { getStepFacts } from "./step-facts.ts";
import { getRunsOnSpec } from "./runs-on-facts.ts";
import { detectLintTool, detectPythonTool } from "./tools.ts";

const dockerBuildxBakePattern = /\bdocker\s+buildx\s+bake\b|\bdocker-buildx\s+bake\b/i;
const dockerBuildPattern = /\bdocker\s+build\b/i;
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

const TOOL_PRESENCE_PATTERNS: Record<string, RegExp> = {
  hasNpmEcosystem:
    /actions\/setup-node@|\boven-sh\/setup-bun@|\bpnpm\/action-setup@|\bvolta-cli\/action@|\b(?:npm|pnpm|yarn|bun)\b|\b(?:eslint|oxlint|tsc|vitest|jest|next build|vite build|webpack|rollup|esbuild|turbo|nx)\b/,
  hasDockerBuild: /docker\/build-push-action@|\bdocker\s+(?:buildx\s+build|build)\b/,
  hasTerraform: /\bterraform\s+init\b/,
  hasPython: /actions\/setup-python@|\b(?:pip\s+install|python\s+-m|pytest|tox|poetry\s+install)\b/,
  hasDatadog: /datadog\/datadog-lambda-extension@|public\.ecr\.aws\/datadog\/lambda-extension/,
  hasElixir: /erlef\/setup-beam@|\belixir\b|\bmix\b|container:\s*elixir:/,
  hasPythonSignal: /\b(?:python|pip|uv|ruff|black|isort|tox|nox|hatch|pdm|pytest)\b/i,
  hasRustSignal: /\b(?:cargo|rustc|nextest)\b/i,
  hasElixirSignal: /\b(?:elixir|erlang|otp|mix|setup-beam)\b/i,
  hasNativePackageSignal:
    /\b(?:npm|pnpm|yarn|bun|node-gyp|prebuild|node-pre-gyp|pip|uv|maturin|setuptools)\b/i,
  hasEslintSignal: /\b(?:eslint|oxlint)\b/i,
  hasPrettierSignal: /\b(?:prettier|oxfmt)\b/i,
  hasFrameworkSignal:
    /\b(?:next|storybook|vite|astro|svelte|turbo|nx|lerna|gradle|gradlew|angular)\b/i,
  hasTypeScriptSignal: /\b(?:tsc|typescript|tsx|ts-jest)\b/i,
  hasJestSignal: /\b(?:jest|jsdom)\b/i,
  hasTailwindSignal: /\b(?:tailwind|postcss)\b/i,
  hasHuskySignal: /\b(?:husky|lint-staged)\b/i,
  hasBabelSignal: /\b(?:babel|@babel\/|core-js)\b/i,
  hasSparseCheckout: /sparse-checkout/i,
  hasNpmRun: /npm run/i,
  hasDockerBuildPushAction: /docker\/build-push-action/,
  hasDockerPush: /--push/,
  hasWebpackOrRspackOrBabel:
    /\b(?:webpack|rspack|babel|ts-loader|fork-ts-checker|next build|vite build|storybook)\b/i,
  hasNpmOrPnpmOrYarnOrBun: /\b(?:npm|pnpm|yarn|bun)\b/i,
};

function computeToolPresence(blob: string): Map<string, boolean> {
  const presence = new Map<string, boolean>();
  for (const [key, pattern] of Object.entries(TOOL_PRESENCE_PATTERNS)) {
    presence.set(key, pattern.test(blob));
  }
  return presence;
}

export interface JobFacts {
  checkoutStep?: WorkflowStep;
  hasSetupBunStep: boolean;
  hasSetupPnpmStep: boolean;
  hasSetupUvStep: boolean;
  hasBuildxBake: boolean;
  isHeavyJob: boolean;
  heavyEvidence: HeavyEvidence;
  hasDirectHeavySignals: boolean;
  hasHistoryDependentCommand: boolean;
  hasOpaqueRepoScriptExecution: boolean;
  looksMetaCheckLike: boolean;
  looksAgenticLike: boolean;
  looksReleaseLike: boolean;
  lintTools: ReadonlySet<string>;
  pythonTools: ReadonlySet<string>;
  loweredStepTextBlob: string;
  checkoutDepth?: number;
  hasTimeout: boolean;
  dockerUsage: boolean;
  setupActions: readonly SetupActionKind[];
  runsOnSpec: RunsOnSpec;
}

export interface WorkflowFacts {
  isHeavyWorkflow: boolean;
  heavyWorkflowEvidence: HeavyWorkflowEvidence;
  hasConcurrency: boolean;
  looksMetaCheckLike: boolean;
  looksAgenticLike: boolean;
  looksReleaseLike: boolean;
  releaseLikeJobIds: ReadonlySet<string>;
  lintTools: ReadonlySet<string>;
  pythonTools: ReadonlySet<string>;
  loweredStepTextBlob: string;
  checkoutDepthsByJob: ReadonlyMap<string, number | undefined>;
  dockerUsageByJob: ReadonlyMap<string, boolean>;
  timeoutPresenceByJob: ReadonlyMap<string, boolean>;
  setupActionsByJob: ReadonlyMap<string, readonly SetupActionKind[]>;
  installFamiliesByJob: ReadonlyMap<string, readonly string[]>;
  triggerFacts: TriggerFacts;
  toolPresence: ReadonlyMap<string, boolean>;
}

const jobFactsCache = new WeakMap<WorkflowJob, JobFacts>();
const workflowFactsCache = new WeakMap<WorkflowDocument, WorkflowFacts>();

const emptyTriggerFacts: TriggerFacts = {
  events: new Set(),
  hasPush: false,
  hasPullRequest: false,
  hasSchedule: false,
  hasWorkflowDispatch: false,
  hasRepositoryDispatch: false,
  hasWorkflowCall: false,
  hasWorkflowRun: false,
  isManualOnly: false,
  push: {
    hasBranches: false,
    hasBranchesIgnore: false,
    hasTags: false,
    hasTagsIgnore: false,
    hasTagOnly: false,
    hasBranchPush: false,
    hasPaths: false,
    hasPathsIgnore: false,
  },
  pullRequest: {
    hasBranches: false,
    hasBranchesIgnore: false,
    hasPaths: false,
    hasPathsIgnore: false,
    hasPathFilter: false,
    hasNonCodeIgnore: false,
  },
  hasTriggerPathFilter: false,
  hasNonCodeIgnore: false,
  scheduleCrons: [],
  activationSurface: "unknown",
};

const emptyWorkflowFacts: WorkflowFacts = {
  isHeavyWorkflow: false,
  heavyWorkflowEvidence: {
    isHeavy: false,
    strength: "weak",
    reasons: [],
    heavyJobCount: 0,
    matchedJobNames: [],
  },
  hasConcurrency: false,
  looksMetaCheckLike: false,
  looksAgenticLike: false,
  looksReleaseLike: false,
  releaseLikeJobIds: new Set(),
  lintTools: new Set(),
  pythonTools: new Set(),
  loweredStepTextBlob: "",
  checkoutDepthsByJob: new Map(),
  dockerUsageByJob: new Map(),
  timeoutPresenceByJob: new Map(),
  setupActionsByJob: new Map(),
  installFamiliesByJob: new Map(),
  triggerFacts: emptyTriggerFacts,
  toolPresence: new Map(),
};

function usesSetupAction(stepUses: string | undefined, prefix: string): boolean {
  return typeof stepUses === "string" && stepUses.toLowerCase().startsWith(prefix);
}

export function hasCheckoutStep(job: WorkflowJob): boolean {
  return getJobFacts(job).checkoutStep !== undefined;
}

export function getCheckoutStep(job: WorkflowJob): WorkflowStep | undefined {
  return getJobFacts(job).checkoutStep;
}

export function hasSetupBunStep(job: WorkflowJob): boolean {
  return getJobFacts(job).hasSetupBunStep;
}

export function hasSetupPnpmStep(job: WorkflowJob): boolean {
  return getJobFacts(job).hasSetupPnpmStep;
}

export function hasSetupUvStep(job: WorkflowJob): boolean {
  return getJobFacts(job).hasSetupUvStep;
}

export function getJobFacts(job: WorkflowJob): JobFacts {
  const cached = jobFactsCache.get(job);
  if (cached) {
    return cached;
  }

  let checkoutStep: WorkflowStep | undefined;
  let foundSetupBunStep = false;
  let foundSetupPnpmStep = false;
  let foundSetupUvStep = false;
  let hasBuildxBake = false;
  let hasDockerBuild = false;
  let hasHeavyStepSignal = false;
  let hasDirectHeavySignals = false;
  let hasHistoryDependentCommand = false;
  let hasOpaqueRepoScriptExecution = false;
  let looksMetaCheckLike = false;
  let looksAgenticLike = false;
  let checkoutFetchDepth: number | undefined;
  let jobHasTimeout = false;
  const setupActions: SetupActionKind[] = [];
  const lintTools = new Set<string>();
  const pythonTools = new Set<string>();
  const loweredStepTexts: string[] = [];

  for (const step of job.steps) {
    const facts = getStepFacts(step);

    if (!checkoutStep && usesSetupAction(step.uses, "actions/checkout@")) {
      checkoutStep = step;
      const fetchDepth = step.with?.["fetch-depth"];
      if (fetchDepth === 0 || fetchDepth === "0") {
        checkoutFetchDepth = 0;
      } else if (typeof fetchDepth === "number" && fetchDepth > 1) {
        checkoutFetchDepth = fetchDepth;
      } else if (typeof fetchDepth === "string" && /^\d+$/.test(fetchDepth)) {
        const n = Number(fetchDepth);
        if (n > 1) {
          checkoutFetchDepth = n;
        }
      } else if (fetchDepth !== undefined) {
        checkoutFetchDepth = undefined;
      }
    }

    foundSetupBunStep ||= usesSetupAction(step.uses, "oven-sh/setup-bun@");
    foundSetupPnpmStep ||= usesSetupAction(step.uses, "pnpm/action-setup@");
    foundSetupUvStep ||= usesSetupAction(step.uses, "astral-sh/setup-uv@");

    const loweredStepText = facts.loweredStepText;
    loweredStepTexts.push(loweredStepText);
    const stepText = facts.stepText;
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

    if (facts.setupActionKind) {
      setupActions.push(facts.setupActionKind);
    }

    hasBuildxBake ||= dockerBuildxBakePattern.test(run);
    hasDockerBuild ||= dockerBuildPattern.test(run);
    hasHeavyStepSignal ||= heavyStepSignalPattern.test(loweredStepText);
    hasDirectHeavySignals ||= directHeavySignalPattern.test(loweredRunNameText);
    hasHistoryDependentCommand ||= historyDependentCommandPattern.test(stepText);
    hasOpaqueRepoScriptExecution ||= opaqueRepoScriptExecutionPattern.test(run);
    looksMetaCheckLike ||= metaCheckLikePattern.test(loweredStepText);
    looksAgenticLike ||= agenticLikePattern.test(loweredStepText);
  }

  const timeoutMinutes = job.raw["timeout-minutes"];
  jobHasTimeout =
    typeof timeoutMinutes === "number" ||
    (typeof timeoutMinutes === "string" && timeoutMinutes.trim().length > 0);

  const loweredId = job.id.toLowerCase();
  const jobNameMatch = heavyJobIdPattern.test(loweredId);
  const isHeavy = jobNameMatch || hasHeavyStepSignal;
  const heavyReasons: string[] = [];
  const heavySignals: string[] = [];
  const strengths: string[] = [];
  if (hasHeavyStepSignal) {
    heavyReasons.push("step signals detected");
    heavySignals.push("install/build/test/lint commands");
    strengths.push("medium");
  }
  if (jobNameMatch) {
    heavyReasons.push(`job name matches heavy pattern`);
    heavySignals.push(`jobId:${job.id}`);
    strengths.push("weak");
  }
  const heavyEvidence: HeavyEvidence = {
    isHeavy,
    strength: combineStrength(strengths as EvidenceStrength[]),
    reasons: heavyReasons,
    matchedSignals: heavySignals,
  };
  const facts: JobFacts = {
    checkoutStep,
    hasSetupBunStep: foundSetupBunStep,
    hasSetupPnpmStep: foundSetupPnpmStep,
    hasSetupUvStep: foundSetupUvStep,
    hasBuildxBake,
    isHeavyJob: isHeavy,
    heavyEvidence,
    hasDirectHeavySignals,
    hasHistoryDependentCommand,
    hasOpaqueRepoScriptExecution,
    looksMetaCheckLike: metaCheckIdPattern.test(loweredId) || looksMetaCheckLike,
    looksAgenticLike: agenticIdPattern.test(loweredId) || looksAgenticLike,
    looksReleaseLike: false,
    lintTools,
    pythonTools,
    loweredStepTextBlob: loweredStepTexts.join("\n"),
    checkoutDepth: checkoutFetchDepth,
    hasTimeout: jobHasTimeout,
    dockerUsage: hasBuildxBake || hasDockerBuild,
    setupActions,
    runsOnSpec: getRunsOnSpec(job),
  };
  jobFactsCache.set(job, facts);
  return facts;
}

export function getWorkflowFacts(
  workflow: WorkflowDocument | PipelineDocument | GitlabCiDocument | CircleCiDocument,
): WorkflowFacts {
  if ("steps" in workflow && !("jobs" in workflow)) {
    return emptyWorkflowFacts;
  }

  if ("kind" in workflow) {
    return emptyWorkflowFacts;
  }

  const wf = workflow as WorkflowDocument;
  const cached = workflowFactsCache.get(wf);
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
  const checkoutDepthsByJob = new Map<string, number | undefined>();
  const dockerUsageByJob = new Map<string, boolean>();
  const timeoutPresenceByJob = new Map<string, boolean>();
  const setupActionsByJob = new Map<string, readonly SetupActionKind[]>();
  const installFamiliesByJob = new Map<string, readonly string[]>();

  for (const job of wf.jobs) {
    const jf = getJobFacts(job);
    hasJobConcurrency ||= Boolean(job.concurrencyNode);
    hasHeavyJob ||= jf.isHeavyJob;
    hasMetaCheckJob ||= jf.looksMetaCheckLike;
    hasAgenticJob ||= jf.looksAgenticLike;
    for (const lintTool of jf.lintTools) {
      lintTools.add(lintTool);
    }
    for (const pythonTool of jf.pythonTools) {
      pythonTools.add(pythonTool);
    }
    loweredStepTexts.push(jf.loweredStepTextBlob);

    checkoutDepthsByJob.set(job.id, jf.checkoutDepth);
    dockerUsageByJob.set(job.id, jf.dockerUsage);
    timeoutPresenceByJob.set(job.id, jf.hasTimeout);
    setupActionsByJob.set(job.id, jf.setupActions);

    const installFamilies: string[] = [];
    for (const step of job.steps) {
      const facts = getStepFacts(step);
      if (facts.installCommand) {
        installFamilies.push(facts.installCommand);
      }
    }
    installFamiliesByJob.set(job.id, installFamilies);
  }

  const triggerFacts = getTriggerFacts(wf);

  const releaseLikeJobIds = new Set<string>();
  const releaseJobIdPattern = /\b(release|rollback|promote|nightly|tag|publish|version)\b/;
  for (const job of wf.jobs) {
    if (releaseJobIdPattern.test(job.id.toLowerCase())) {
      releaseLikeJobIds.add(job.id);
    }
  }
  const wfNameLooksRelease = /\b(release|rollback|promote|nightly|tag|version)\b/.test(loweredName);
  const hasPushTags = triggerFacts.push.hasTags || triggerFacts.push.hasTagsIgnore;
  const looksReleaseLike = wfNameLooksRelease || hasPushTags;

  for (const job of wf.jobs) {
    const jf = getJobFacts(job);
    const mutable = jf as { looksReleaseLike: boolean };
    mutable.looksReleaseLike = releaseLikeJobIds.has(job.id) || looksReleaseLike;
  }

  const wfNameHeavy = heavyWorkflowNamePattern.test(loweredName);
  const heavyJobNames: string[] = [];
  let heavyJobCount = 0;
  for (const job of wf.jobs) {
    const jf = getJobFacts(job);
    if (jf.isHeavyJob) {
      heavyJobCount++;
      heavyJobNames.push(job.id);
    }
  }
  const wfHeavyReasons: string[] = [];
  const wfHeavySignals: string[] = [];
  const wfHeavyStrengths: string[] = [];
  if (heavyJobCount > 0) {
    wfHeavyReasons.push(`${heavyJobCount} heavy job(s)`);
    wfHeavySignals.push(...heavyJobNames);
    wfHeavyStrengths.push("medium");
  }
  if (wfNameHeavy) {
    wfHeavyReasons.push("workflow name matches heavy pattern");
    wfHeavySignals.push(`name:${wf.name}`);
    wfHeavyStrengths.push("weak");
  }

  const blob = loweredStepTexts.join("\n");

  const facts: WorkflowFacts = {
    isHeavyWorkflow: wfNameHeavy || hasHeavyJob,
    heavyWorkflowEvidence: {
      isHeavy: wfNameHeavy || hasHeavyJob,
      strength: combineStrength(wfHeavyStrengths as EvidenceStrength[]),
      reasons: wfHeavyReasons,
      heavyJobCount,
      matchedJobNames: heavyJobNames,
    },
    hasConcurrency: Boolean(wf.concurrencyNode) || hasJobConcurrency,
    looksMetaCheckLike: metaCheckWorkflowNamePattern.test(loweredName) || hasMetaCheckJob,
    looksAgenticLike: agenticWorkflowNamePattern.test(loweredName) || hasAgenticJob,
    looksReleaseLike,
    releaseLikeJobIds,
    lintTools,
    pythonTools,
    loweredStepTextBlob: blob,
    checkoutDepthsByJob,
    dockerUsageByJob,
    timeoutPresenceByJob,
    setupActionsByJob,
    installFamiliesByJob,
    triggerFacts,
    toolPresence: computeToolPresence(blob),
  };
  workflowFactsCache.set(wf, facts);
  return facts;
}

function regexMatches(text: string, matcher: RegExp): boolean {
  matcher.lastIndex = 0;
  return matcher.test(text);
}

export function workflowUsesLintTool(workflow: WorkflowDocument, tool: string): boolean {
  return getWorkflowFacts(workflow).lintTools.has(tool);
}

export function workflowUsesPythonTool(workflow: WorkflowDocument, tool: string): boolean {
  return getWorkflowFacts(workflow).pythonTools.has(tool);
}

export function workflowStepTextMatches(workflow: WorkflowDocument, matcher: RegExp): boolean {
  return regexMatches(getWorkflowFacts(workflow).loweredStepTextBlob, matcher);
}
