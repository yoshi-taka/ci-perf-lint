import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  AWS_CDK_LIB_PACKAGE,
  compareSemver,
  formatSemver,
  parseDependencyVersionSpec,
  type SemverTuple,
} from "../rules/shared/cdk-express.ts";

const METADATA_COLLECTION_MIN: SemverTuple = [2, 178, 0];
const VALIDATOR_BUGGY_MIN: SemverTuple = [2, 262, 0];
const VALIDATOR_FIXED_VERSION: SemverTuple = [2, 267, 0];

const versionReportingMeta = {
  id: "prefer-cdk-version-reporting-disabled",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-version-reporting-disabled.md",
} satisfies RuleMeta;

const cdkLibVersionMeta = {
  id: "prefer-aws-cdk-lib-2-267",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-aws-cdk-lib-2-267.md",
} satisfies RuleMeta;

const cdkOfflineValidationMeta = {
  id: "prefer-aws-cdk-lib-offline-validation",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-aws-cdk-lib-offline-validation.md",
} satisfies RuleMeta;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isDisabled(value: unknown): boolean {
  return value === false || value === "false";
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

async function readDeclaredCdkLibVersion(
  context: RepositoryScanContext,
): Promise<SemverTuple | undefined> {
  const packageJson = await context.loadPackageJson();
  const dependencies = {
    ...asRecord(packageJson.value?.dependencies),
    ...asRecord(packageJson.value?.devDependencies),
  };
  const declared = dependencies[AWS_CDK_LIB_PACKAGE];
  return parseDependencyVersionSpec(typeof declared === "string" ? declared : undefined);
}

interface CdkJsonEntry {
  path: string;
  value: Record<string, unknown>;
}

async function readCdkJson(context: RepositoryScanContext): Promise<CdkJsonEntry | undefined> {
  const cdkJsonPath = context.resolve("cdk.json");
  if (!(await context.pathExists(cdkJsonPath))) {
    return undefined;
  }
  const text = await context.readTextFileOrWarn(cdkJsonPath);
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { path: cdkJsonPath, value: parsed as Record<string, unknown> };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function collectCdkVersionReportingDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const version = await readDeclaredCdkLibVersion(context);
  if (!version || compareSemver(version, METADATA_COLLECTION_MIN) < 0) {
    return [];
  }

  const cdkJson = await readCdkJson(context);
  if (!cdkJson) {
    return [];
  }

  if (isDisabled(cdkJson.value.versionReporting)) {
    return [];
  }
  const contextRecord = asRecord(cdkJson.value.context);
  if (isDisabled(contextRecord?.["@aws-cdk/core:enableAdditionalMetadataCollection"])) {
    return [];
  }

  const versionLabel = formatSemver(version);
  const relativePath = normalizeRelativePath(repoRoot, cdkJson.path);

  return [
    buildRepositoryDiagnostic(repository, versionReportingMeta, {
      location: {
        path: relativePath,
        line: 1,
        column: 1,
      },
      message: `CDK usage data reporting is enabled while using aws-cdk-lib ${versionLabel}, which includes the expanded metadata collection added in 2.178.0.`,
      why: "The additional metadata collection walks every construct property to redact and report usage data during synthesis. On Node.js 24 this has caused large synthesis slowdowns (reported up to roughly 13x), on top of the telemetry itself. CDK apps created with aws-cdk-lib 2.178.0 or later cannot disable only the additional collection, so usage data reporting must be turned off as a whole.",
      suggestion: 'Set "versionReporting": false in cdk.json to disable CDK usage data reporting.',
      measurementHint:
        "Compare cdk synth wall-clock time before and after disabling version reporting, and confirm the synthesized template no longer carries collected usage data.",
      aiHandoff: `Review cdk.json in this repository. It does not disable CDK usage data reporting while aws-cdk-lib is ${versionLabel}. Set "versionReporting": false at the top level of cdk.json and keep unrelated context and feature-flag settings unchanged, then verify synthesis output and CI timing.`,
      score: 44,
    }),
  ];
}

export async function collectCdkLibVersionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const version = await readDeclaredCdkLibVersion(context);
  if (!version) {
    return [];
  }
  if (compareSemver(version, VALIDATOR_BUGGY_MIN) < 0) {
    return [];
  }
  if (compareSemver(version, VALIDATOR_FIXED_VERSION) >= 0) {
    return [];
  }

  const versionLabel = formatSemver(version);
  const packageJsonPath = normalizeRelativePath(repoRoot, context.resolve("package.json"));

  return [
    buildRepositoryDiagnostic(repository, cdkLibVersionMeta, {
      location: {
        path: packageJsonPath,
        line: 1,
        column: 1,
      },
      message: `aws-cdk-lib ${versionLabel} is in the range where the built-in offline CloudFormation validator can hang and synthesis performance counters can consume excessive memory.`,
      why: "aws-cdk-lib 2.262.0 began validating synthesized templates against default rules, but the bundled validator could hang or blow up on templates with many parameters and chained conditions, and the performance counters could consume excessive memory. The validator hang was fixed in 2.265.0 and the performance-counter memory use in 2.267.0.",
      suggestion: "Upgrade aws-cdk-lib to 2.267.0 or later.",
      measurementHint:
        "Compare cdk synth and cdk deploy wall-clock time before and after the upgrade, and confirm validation finishes instead of hanging.",
      aiHandoff: `Bump aws-cdk-lib to 2.267.0 or later in package.json and refresh the lockfile. This repository is currently on ${versionLabel}, inside the range affected by the broken offline validator and performance-counter memory use. Re-run synthesis and a deployment dry run afterwards to confirm validation completes.`,
      score: 34,
    }),
  ];
}

export async function collectCdkOfflineValidationDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const version = await readDeclaredCdkLibVersion(context);
  if (!version) {
    return [];
  }
  if (compareSemver(version, VALIDATOR_BUGGY_MIN) >= 0) {
    return [];
  }

  const versionLabel = formatSemver(version);
  const packageJsonPath = normalizeRelativePath(repoRoot, context.resolve("package.json"));

  return [
    buildRepositoryDiagnostic(repository, cdkOfflineValidationMeta, {
      location: {
        path: packageJsonPath,
        line: 1,
        column: 1,
      },
      message: `aws-cdk-lib ${versionLabel} predates the built-in offline CloudFormation validation added in 2.262.0.`,
      why: "aws-cdk-lib 2.262.0 began validating synthesized templates against default CloudFormation rules immediately after synthesis, so misconfigurations fail before any deployment or provisioning and without a change-set round trip. Upgrading enables that fail-fast feedback during cdk synth and cdk deploy. Target 2.267.0 or later to also avoid the validator and performance-counter bugs in 2.262.0-2.266.x.",
      suggestion: "Upgrade aws-cdk-lib to 2.267.0 or later.",
      measurementHint:
        "Compare cdk synth and cdk deploy wall-clock time and failure feedback before and after the upgrade, and confirm validation runs right after synthesis.",
      aiHandoff: `Bump aws-cdk-lib to 2.267.0 or later in package.json and refresh the lockfile. This repository is on ${versionLabel}, below the 2.262.0 release that added automatic offline CloudFormation validation. Confirm synthesis emits validation results afterwards and keep unrelated dependency changes out of the bump.`,
      score: 32,
    }),
  ];
}
