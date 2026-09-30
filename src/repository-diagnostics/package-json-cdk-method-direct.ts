import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  cdkCliVersionSupportsMethodDirect,
  formatSemver,
  readCdkCliVersionFromScanContext,
  scriptNameLooksDevelopment,
  textDeploysCdkWithoutMethodDirect,
} from "../rules/shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-method-direct-in-development",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-method-direct-in-development.md",
} satisfies RuleMeta;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineColumnForIndex(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1)?.length ? lines.at(-1)!.length + 1 : 1,
  };
}

function findPackageJsonScriptLocation(
  packageJsonText: string,
  scriptName: string,
): { line: number; column: number } {
  const keyMatch = new RegExp(`"${escapeRegex(scriptName)}"\\s*:`).exec(packageJsonText);
  return lineColumnForIndex(packageJsonText, keyMatch?.index ?? 0);
}

function normalizeRelativePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
}

export async function collectPackageJsonCdkMethodDirectDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);
  const packageJsonEntry = await context.loadPackageJson();
  const packageJson = packageJsonEntry.value;
  const packageJsonText = packageJsonEntry.text ?? "";
  const scripts = asRecord(packageJson?.scripts);
  if (!scripts || packageJsonText.length === 0) {
    return [];
  }

  const offendingScripts = Object.entries(scripts).filter(
    ([scriptName, scriptCommand]) =>
      typeof scriptCommand === "string" &&
      scriptNameLooksDevelopment(scriptName) &&
      textDeploysCdkWithoutMethodDirect(scriptCommand),
  );
  if (offendingScripts.length === 0) {
    return [];
  }

  const version = await readCdkCliVersionFromScanContext(context);
  if (!cdkCliVersionSupportsMethodDirect(version)) {
    return [];
  }

  const versionClause = version ? ` (aws-cdk ${formatSemver(version)})` : "";
  const relativePath = normalizeRelativePath(repoRoot, packageJsonEntry.path);
  const location = findPackageJsonScriptLocation(packageJsonText, offendingScripts[0]![0]);
  const scriptList = offendingScripts.map(([name]) => `"${name}"`).join(", ");

  return [
    buildRepositoryDiagnostic(repository, meta, {
      location: {
        path: relativePath,
        line: location.line,
        column: location.column,
      },
      message: `package.json development script(s) run cdk deploy without --method=direct${versionClause}: ${scriptList}.`,
      why: "By default cdk deploy creates and executes a CloudFormation change set, which can add 6-15 seconds per stack before the deployment starts. --method=direct applies the change immediately through CreateStack or UpdateStack, skipping change set creation while still performing a full CloudFormation deployment with automatic rollback and stabilization.",
      suggestion:
        "Use cdk deploy --method=direct for development deployments to skip change set creation.",
      measurementHint:
        "Compare deployment wall-clock time before and after switching to --method=direct, and confirm no change-set review or tooling depends on the change set.",
      aiHandoff: `Review package.json development script(s) ${scriptList}. Add --method=direct, but do not use it where a change set is required (--change-set-name, --import-existing-resources, --revert-drift) or where a review step inspects the change set. Do not apply this to production or release scripts.`,
      score: 30,
    }),
  ];
}
