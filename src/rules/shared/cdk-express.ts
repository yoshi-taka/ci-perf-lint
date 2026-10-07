import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import type { RuleContext } from "../../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob, WorkflowStep } from "../../workflow.ts";
import { readLockedDependencyVersion } from "../../repository-dependency-versions.ts";
import { workflowLooksReleaseLike } from "./workflow-jobs.ts";
import { getTriggerSemantics } from "./workflow-triggers.ts";
import { shellCommandSegments } from "./command-patterns.ts";

const AWS_CDK_CLI_PACKAGE = "aws-cdk";

const AWS_CDK_LIB_PACKAGE = "aws-cdk-lib";

export type SemverTuple = readonly [number, number, number];

const CDK_EXPRESS_MIN: SemverTuple = [2, 1138, 0];

const CDK_HOTSWAP_MIN: SemverTuple = [2, 1125, 0];

const CDK_METHOD_DIRECT_MIN: SemverTuple = [2, 118, 0];

const CDK_DEPLOY_VERB = /\b(?:aws-cdk|cdk)\s+(?:deploy|destroy|bootstrap)\b/;

const CDK_INSTALL_VERSION = /\b(?:aws-cdk|cdk)@(\d+\.\d+(?:\.\d+)?)/;

const EXPRESS_FLAG = /(?:^|\s)--express(?=\s|=|$)/;

const EXACT_VERSION_SPEC = /^[=v]?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/;

function parseDependencyVersionSpec(spec: string | undefined): SemverTuple | undefined {
  if (!spec) {
    return undefined;
  }
  const trimmed = spec.trim();
  if (!EXACT_VERSION_SPEC.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }
  const major = Number.parseInt(match[1]!, 10);
  const minor = Number.parseInt(match[2]!, 10);
  const patch = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return undefined;
  }
  return [major, minor, patch];
}

function extractCdkCliVersionFromText(text: string): SemverTuple | undefined {
  const match = CDK_INSTALL_VERSION.exec(text);
  return match?.[1] ? parseDependencyVersionSpec(match[1]) : undefined;
}

export function compareSemver(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i]! < b[i]! ? -1 : 1;
    }
  }
  return 0;
}

export function cdkVersionIsBelowExpressFloor(version: SemverTuple | undefined): boolean {
  return version !== undefined && compareSemver(version, CDK_EXPRESS_MIN) < 0;
}

export function formatSemver(version: SemverTuple): string {
  return version.join(".");
}

function textHasCdkExpressFlag(text: string): boolean {
  return EXPRESS_FLAG.test(text);
}

export function textDeploysCdkWithoutExpress(text: string): boolean {
  return CDK_DEPLOY_VERB.test(text) && !textHasCdkExpressFlag(text);
}

const CDK_WATCH_VERB = /\b(?:aws-cdk|cdk)\s+watch\b/;

const HOTSWAP_FLAG = /--hotswap(?:-fallback)?\b/;

export function textUsesCdkHotswap(text: string): boolean {
  if (CDK_WATCH_VERB.test(text)) {
    return true;
  }
  return CDK_DEPLOY_VERB.test(text) && HOTSWAP_FLAG.test(text);
}

export function cdkCliVersionIsBelowHotswapFloor(version: SemverTuple | undefined): boolean {
  return version !== undefined && compareSemver(version, CDK_HOTSWAP_MIN) < 0;
}

const CDK_DEPLOY_ONLY = /\b(?:aws-cdk|cdk)\s+deploy\b/;

const METHOD_FLAG = /(?:^|\s)(?:--method|-m)(?=\s|=|$)/;

const METHOD_DIRECT_INCOMPATIBLE = /--import-existing-resources\b|--revert-drift\b/;

export function textDeploysCdkWithoutMethodDirect(text: string): boolean {
  return (
    CDK_DEPLOY_ONLY.test(text) && !METHOD_FLAG.test(text) && !METHOD_DIRECT_INCOMPATIBLE.test(text)
  );
}

const ASSET_BUILD_CONCURRENCY_FLAG = /--asset-build-concurrency\b/;

export function textDeploysCdkWithoutAssetBuildConcurrency(text: string): boolean {
  return CDK_DEPLOY_ONLY.test(text) && !ASSET_BUILD_CONCURRENCY_FLAG.test(text);
}

export function cdkCliVersionSupportsMethodDirect(version: SemverTuple | undefined): boolean {
  return version === undefined || compareSemver(version, CDK_METHOD_DIRECT_MIN) >= 0;
}

const PRODUCTION_ENVIRONMENT = /(?:^|[^a-z])(?:prod|production|prd)(?:$|[^a-z])/i;

const DEVELOPMENT_ENVIRONMENT = /(?:^|[^a-z])(?:dev|development|sandbox|preview)(?:$|[^a-z])/i;

function readEnvironmentNames(job: WorkflowJob): string[] {
  const environment = job.raw.environment;
  if (typeof environment === "string") {
    return [environment];
  }
  const record = asRecord(environment);
  const name = record?.name;
  return typeof name === "string" ? [name] : [];
}

export function jobTargetsDevelopment(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): { development: boolean; production: boolean } {
  const environmentNames = readEnvironmentNames(job);
  const production =
    environmentNames.some((name) => PRODUCTION_ENVIRONMENT.test(name)) ||
    workflowLooksReleaseLike(workflow, job);
  const triggers = getTriggerSemantics(workflow);
  const development =
    environmentNames.some((name) => DEVELOPMENT_ENVIRONMENT.test(name)) || triggers.hasPullRequest;
  return { development, production: production || triggers.hasTagOnlyPush };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readInstalledDependencyVersion(
  scanContext: RepositoryScanContext | undefined,
  packageName: string,
): Promise<SemverTuple | undefined> {
  if (!scanContext) {
    return undefined;
  }

  return parseDependencyVersionSpec(await readLockedDependencyVersion(scanContext, packageName));
}

async function readDeclaredDependencyVersion(
  scanContext: RepositoryScanContext | undefined,
  packageName: string,
): Promise<SemverTuple | undefined> {
  const installed = await readInstalledDependencyVersion(scanContext, packageName);
  if (installed) {
    return installed;
  }

  const packageJson = await scanContext?.loadPackageJson();
  const dependencies = {
    ...asRecord(packageJson?.value?.dependencies),
    ...asRecord(packageJson?.value?.devDependencies),
  };
  const declared = dependencies[packageName];
  return parseDependencyVersionSpec(typeof declared === "string" ? declared : undefined);
}

export function readCdkCliVersionFromScanContext(
  scanContext: RepositoryScanContext | undefined,
): Promise<SemverTuple | undefined> {
  return readDeclaredDependencyVersion(scanContext, AWS_CDK_CLI_PACKAGE);
}

export function readCdkLibVersionFromScanContext(
  scanContext: RepositoryScanContext | undefined,
): Promise<SemverTuple | undefined> {
  return readDeclaredDependencyVersion(scanContext, AWS_CDK_LIB_PACKAGE);
}

export async function groupCdkStepsByCliVersion(
  job: WorkflowJob,
  context: RuleContext,
  steps: WorkflowStep[],
  matchesCommand: (text: string) => boolean,
): Promise<{ version: SemverTuple | undefined; steps: WorkflowStep[] }[]> {
  const groups = new Map<string, { version: SemverTuple | undefined; steps: WorkflowStep[] }>();
  const candidates = new Set(steps);
  let version: SemverTuple | undefined;
  let readDeclaredVersion = false;
  for (const step of job.steps) {
    for (const command of shellCommandSegments(step.run ?? "")) {
      version = extractCdkCliVersionFromText(command) ?? version;
      if (!candidates.has(step) || !matchesCommand(command)) {
        continue;
      }
      if (!version && !readDeclaredVersion) {
        version = await readCdkCliVersionFromScanContext(context.scanContext);
        readDeclaredVersion = true;
      }
      const key = version ? formatSemver(version) : "unknown";
      const group = groups.get(key);
      // Keep the source anchor while reporting only the command using this CLI version.
      const commandStep = { ...step, run: command };
      if (group) {
        group.steps.push(commandStep);
      } else {
        groups.set(key, { version, steps: [commandStep] });
      }
    }
  }
  return [...groups.values()];
}

const DEV_SCRIPT_TOKEN = /(?:^|[:_-])(?:dev|development|sandbox|preview)(?:$|[:_-])/i;

export function scriptNameLooksDevelopment(name: string): boolean {
  return DEV_SCRIPT_TOKEN.test(name);
}

export const CDK_EXPRESS_WHY =
  "CloudFormation express mode reports stack operations as complete as soon as CloudFormation applies the resource configuration, instead of waiting for stabilization, traffic readiness, region propagation, and cleanup. AWS measures up to 4x faster deployments and designs express mode for iterative development deployments, where it is not recommended for production and disables automatic rollback by default.";

export const CDK_EXPRESS_SUGGESTION =
  "Add --express to development cdk deploy, destroy, and bootstrap commands to use CloudFormation express mode.";

export const CDK_EXPRESS_UPGRADE_SUGGESTION =
  "Upgrade the aws-cdk CLI to 2.1138.0 or later, then add --express to development cdk deploy, destroy, and bootstrap commands.";

export const CDK_EXPRESS_MEASUREMENT_HINT =
  "Compare the CDK deploy step wall-clock duration and CloudFormation stack event times before and after enabling express mode, and confirm the target is a development environment where automatic rollback is not required.";
