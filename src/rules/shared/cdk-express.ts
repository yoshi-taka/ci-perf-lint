import type { RepositoryScanContext } from "../../repository-scan-context.ts";
import type { RuleContext } from "../../rule-engine.ts";
import type { WorkflowDocument } from "../../workflow.ts";

export const AWS_CDK_CLI_PACKAGE = "aws-cdk";

export const AWS_CDK_LIB_PACKAGE = "aws-cdk-lib";

export type SemverTuple = readonly [number, number, number];

const CDK_EXPRESS_MIN: SemverTuple = [2, 1138, 0];

const CDK_HOTSWAP_MIN: SemverTuple = [2, 1125, 0];

const CDK_DEPLOY_VERB = /\b(?:aws-cdk|cdk)\s+(?:deploy|destroy|bootstrap)\b/;

const CDK_INSTALL_VERSION = /\b(?:aws-cdk|cdk)@(\d+\.\d+(?:\.\d+)?)/;

const EXPRESS_FLAG = /(?:^|\s)--express(?=\s|=|$)/;

const EXACT_VERSION_SPEC = /^[=v]?\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/;

export function parseDependencyVersionSpec(spec: string | undefined): SemverTuple | undefined {
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function readCdkCliVersionFromScanContext(
  scanContext: RepositoryScanContext | undefined,
): Promise<SemverTuple | undefined> {
  const packageJson = await scanContext?.loadPackageJson();
  const dependencies = {
    ...asRecord(packageJson?.value?.dependencies),
    ...asRecord(packageJson?.value?.devDependencies),
  };
  const declared = dependencies[AWS_CDK_CLI_PACKAGE];
  return parseDependencyVersionSpec(typeof declared === "string" ? declared : undefined);
}

export async function resolveCdkCliVersion(
  workflow: WorkflowDocument,
  context: RuleContext,
): Promise<SemverTuple | undefined> {
  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const version = extractCdkCliVersionFromText(step.run ?? "");
      if (version) {
        return version;
      }
    }
  }
  return readCdkCliVersionFromScanContext(context.scanContext);
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
