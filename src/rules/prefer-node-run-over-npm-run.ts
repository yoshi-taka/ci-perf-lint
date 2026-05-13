import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getSetupActionKind } from "./shared/workflow-setup-actions.ts";
import { detectSimpleNpmRunFromText } from "./shared/command-patterns.ts";
import { setIntersection } from "../set-algebra.ts";
import { sourceContains } from "./shared/predicate.ts";
import { predicateToPrecheck } from "./shared/predicate-score.ts";

const precheckPredicates = [{ pred: sourceContains("npm run"), weight: 1, label: "has-npm-run" }];

const meta = {
  id: "prefer-node-run-over-npm-run",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-node-run-over-npm-run.md",
  scope: "all",
  precheck: predicateToPrecheck(precheckPredicates),
  impliedChecks: ["prefer-npm-ci"],
} satisfies RuleMeta;

function parseVisibleNodeMajor(version: unknown): number | undefined {
  if (typeof version === "number" && Number.isInteger(version)) {
    return version;
  }
  if (typeof version !== "string") {
    return undefined;
  }
  const trimmed = version.trim();
  if (trimmed.startsWith("${{")) {
    return undefined;
  }
  const match = trimmed.match(/^(?:v)?(\d+)(?:\.|$|x)/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function extractNodeMajorFromAny(text: string): number | undefined {
  const major = parseVisibleNodeMajor(text);
  if (major !== undefined) {
    return major;
  }
  const m = text.match(/(\d+)/);
  if (m) {
    return Number.parseInt(m[1]!, 10);
  }
  return undefined;
}

function nodeVersionFromDockerImages(images: string[] | undefined): number | undefined {
  if (!images) {
    return undefined;
  }
  for (const img of images) {
    const m = img.match(/(?:\/|^)node[:/](\d+)/i);
    if (m) {
      return Number.parseInt(m[1]!, 10);
    }
  }
  return undefined;
}

async function getRepositoryNodeVersion(
  scanContext: RepositoryScanContext | undefined,
): Promise<number | undefined> {
  if (!scanContext) {
    return undefined;
  }

  const nvPath = scanContext.resolve(".node-version");
  if (await scanContext.pathExists(nvPath)) {
    const text = await scanContext.readTextFileOrWarn(nvPath);
    if (text) {
      const major = extractNodeMajorFromAny(text);
      if (major !== undefined) {
        return major;
      }
    }
  }

  const nvmPath = scanContext.resolve(".nvmrc");
  if (await scanContext.pathExists(nvmPath)) {
    const text = await scanContext.readTextFileOrWarn(nvmPath);
    if (text) {
      const major = extractNodeMajorFromAny(text);
      if (major !== undefined) {
        return major;
      }
    }
  }

  const pkg = await scanContext.loadPackageJson();
  const engines = pkg.value?.engines as Record<string, unknown> | undefined;
  if (engines?.node && typeof engines.node === "string") {
    const major = extractNodeMajorFromAny(engines.node);
    if (major !== undefined) {
      return major;
    }
  }

  return undefined;
}

function stepTargetsNodeRunCapableVersion(step: WorkflowStep): boolean {
  if (getSetupActionKind(step) !== "node") {
    return false;
  }
  const major = parseVisibleNodeMajor(step.with?.["node-version"]);
  return typeof major === "number" && major >= 22;
}

function npmCompatibilityEvidence(repository: RepositorySignals, script: string): string {
  const evidence: string[] = [];
  const lifecycleHooks = [
    ...setIntersection([`pre${script}`, `post${script}`], repository.npm.lifecycleHookScripts),
  ];

  if (lifecycleHooks.length > 0) {
    evidence.push(`lifecycle hooks ${lifecycleHooks.join("/")}`);
  }

  if (repository.npm.npmrcRelevantSettings.length > 0) {
    evidence.push(
      `npmrc settings ${repository.npm.npmrcRelevantSettings.map((setting) => `\`${setting}\``).join(", ")}`,
    );
  } else if (repository.npm.npmrcFiles.length > 0) {
    evidence.push(
      `npmrc files ${repository.npm.npmrcFiles.map((file) => `\`${file}\``).join(", ")}`,
    );
  }

  if (repository.npm.packageScriptEnvReferences.length > 0) {
    evidence.push(
      `package scripts reference npm-provided env in ${repository.npm.packageScriptEnvReferences.map((name) => `"${name}"`).join(", ")}`,
    );
  }

  if (repository.npm.workflowEnvReferences.length > 0) {
    evidence.push(
      `workflows reference npm-related env in ${repository.npm.workflowEnvReferences.map((file) => `\`${file}\``).join(", ")}`,
    );
  }

  return evidence.length > 0
    ? `Visible npm-specific compatibility evidence: ${evidence.join("; ")}.`
    : "Repository scan found no visible .npmrc file, matching pre/post lifecycle script, or npm-specific environment reference.";
}

function isCircleCiDoc(doc: unknown): doc is CircleCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "circleci"
  );
}

function isGitlabCiDoc(doc: unknown): doc is GitlabCiDocument {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "kind" in doc &&
    (doc as Record<string, unknown>).kind === "gitlab-ci"
  );
}

function isPipelineDoc(doc: unknown): doc is PipelineDocument {
  return typeof doc === "object" && doc !== null && "steps" in doc && !("jobs" in doc);
}

function checkGithubActions(workflow: WorkflowDocument, context: RuleContext): Diagnostic[] {
  const findings: Diagnostic[] = [];

  for (const job of workflow.jobs) {
    if (!job.steps.some((step) => stepTargetsNodeRunCapableVersion(step))) {
      continue;
    }

    for (const step of job.steps) {
      const npmRun = detectSimpleNpmRunFromText(step.run ?? "");
      if (!npmRun) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
          message: `Job "${job.id}" runs package script "${npmRun.script}" through npm run.`,
          why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
          suggestion:
            "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
          measurementHint:
            "Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" step running \`npm run ${npmRun.script}\`. Only replace it with \`${npmRun.replacement}\` after checking the collected compatibility evidence: ${npmCompatibilityEvidence(context.repository, npmRun.script)}`,
          score: 38,
        }),
      );
    }
  }

  return findings;
}

async function checkBuildkite(
  pipeline: PipelineDocument,
  context: RuleContext,
): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  const repoNodeVersion = await getRepositoryNodeVersion(context.scanContext);
  if (repoNodeVersion !== undefined && repoNodeVersion < 22) {
    return findings;
  }

  for (const step of pipeline.steps) {
    if (step.isWait || step.isBlock || step.isTrigger || step.isGroup) {
      continue;
    }

    const commandTexts: string[] = [];
    if (step.command) {
      commandTexts.push(step.command);
    }
    if (Array.isArray(step.commands)) {
      commandTexts.push(...step.commands);
    }

    for (const cmd of commandTexts) {
      const npmRun = detectSimpleNpmRunFromText(cmd);
      if (!npmRun) {
        continue;
      }

      findings.push(
        buildDiagnostic(pipeline, meta, step.commandNode ?? step.node, {
          message: `Step "${step.label ?? step.key ?? "(unnamed)"}" runs package script "${npmRun.script}" through npm run.`,
          why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
          suggestion:
            "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
          measurementHint:
            "Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
          aiHandoff: `Review ${pipeline.relativePath} step "${step.label ?? step.key ?? "(unnamed)"}" running \`npm run ${npmRun.script}\`. Only replace it with \`${npmRun.replacement}\` after checking the collected compatibility evidence: ${npmCompatibilityEvidence(context.repository, npmRun.script)}`,
          score: 38,
        }),
      );
    }
  }

  return findings;
}

async function checkCircleCi(doc: CircleCiDocument, context: RuleContext): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  const repoNodeVersion = await getRepositoryNodeVersion(context.scanContext);

  for (const job of doc.jobs) {
    const jobNodeVersion = nodeVersionFromDockerImages(job.dockerImages) ?? repoNodeVersion;
    if (jobNodeVersion !== undefined && jobNodeVersion < 22) {
      continue;
    }

    for (const step of job.steps) {
      const npmRun = detectSimpleNpmRunFromText(step.command ?? "");
      if (!npmRun) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, step.commandNode ?? step.node, {
          message: `Job "${job.name}" step "${step.name ?? step.command ?? "(unnamed)"}" runs package script "${npmRun.script}" through npm run.`,
          why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
          suggestion:
            "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
          measurementHint:
            "Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
          aiHandoff: `Review ${doc.relativePath} job "${job.name}" step running \`npm run ${npmRun.script}\`. Only replace it with \`${npmRun.replacement}\` after checking the collected compatibility evidence: ${npmCompatibilityEvidence(context.repository, npmRun.script)}`,
          score: 38,
        }),
      );
    }
  }

  return findings;
}

async function checkGitlabCi(doc: GitlabCiDocument, context: RuleContext): Promise<Diagnostic[]> {
  const findings: Diagnostic[] = [];
  const repoNodeVersion = await getRepositoryNodeVersion(context.scanContext);

  for (const job of doc.jobs) {
    const image = job.image;
    const jobNodeVersion = image ? nodeVersionFromDockerImages([image]) : repoNodeVersion;
    if (jobNodeVersion !== undefined && jobNodeVersion < 22) {
      continue;
    }

    for (const cmd of job.script ?? []) {
      const npmRun = detectSimpleNpmRunFromText(cmd);
      if (!npmRun) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, job.scriptNode ?? job.node, {
          message: `Job "${job.name}" runs package script "${npmRun.script}" through npm run.`,
          why: "For simple package-script execution on recent Node.js, node --run can avoid npm startup overhead. It is not a drop-in replacement when npm-specific behavior is required.",
          suggestion:
            "Replace npm run with node --run for simple package-script execution when no npm-specific behavior is needed.",
          measurementHint:
            "Compare the step duration before and after the change, and verify that the script still receives the same arguments and environment it needs.",
          aiHandoff: `Review ${doc.relativePath} job "${job.name}" running \`npm run ${npmRun.script}\`. Only replace it with \`${npmRun.replacement}\` after checking the collected compatibility evidence: ${npmCompatibilityEvidence(context.repository, npmRun.script)}`,
          score: 38,
        }),
      );
    }
  }

  return findings;
}

export const preferNodeRunOverNpmRunRule = {
  meta,
  async check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    context: RuleContext,
  ): Promise<Diagnostic[]> {
    if (isCircleCiDoc(workflow)) {
      return checkCircleCi(workflow, context);
    }
    if (isGitlabCiDoc(workflow)) {
      return checkGitlabCi(workflow, context);
    }
    if (isPipelineDoc(workflow)) {
      return checkBuildkite(workflow, context);
    }
    return checkGithubActions(workflow, context);
  },
};
