export const AWS_CDK_CLI_PACKAGE = "aws-cdk";

export const AWS_CDK_LIB_PACKAGE = "aws-cdk-lib";

export type SemverTuple = readonly [number, number, number];

const CDK_EXPRESS_MIN: SemverTuple = [2, 1138, 0];

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

export function extractCdkCliVersionFromText(text: string): SemverTuple | undefined {
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
