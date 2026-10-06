import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  CDK_EXPRESS_MEASUREMENT_HINT,
  CDK_EXPRESS_SUGGESTION,
  CDK_EXPRESS_UPGRADE_SUGGESTION,
  CDK_EXPRESS_WHY,
  cdkVersionIsBelowExpressFloor,
  formatSemver,
  readCdkCliVersionFromScanContext,
  scriptNameLooksDevelopment,
  textDeploysCdkWithoutExpress,
} from "../rules/shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-express-mode-in-development",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-express-mode-in-development.md",
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

export async function collectPackageJsonCdkExpressDiagnostics(
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
      textDeploysCdkWithoutExpress(scriptCommand),
  );
  if (offendingScripts.length === 0) {
    return [];
  }

  const version = await readCdkCliVersionFromScanContext(context);
  const needsUpgrade = cdkVersionIsBelowExpressFloor(version);
  const versionLabel = version ? formatSemver(version) : undefined;

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
      message: needsUpgrade
        ? `package.json development script(s) run cdk deploy, destroy, or bootstrap without express mode, and the declared aws-cdk ${versionLabel} predates --express support: ${scriptList}.`
        : `package.json development script(s) run cdk deploy, destroy, or bootstrap without express mode${versionLabel ? ` (aws-cdk ${versionLabel})` : ""}: ${scriptList}.`,
      why: CDK_EXPRESS_WHY,
      suggestion: needsUpgrade ? CDK_EXPRESS_UPGRADE_SUGGESTION : CDK_EXPRESS_SUGGESTION,
      measurementHint: CDK_EXPRESS_MEASUREMENT_HINT,
      aiHandoff: `Review package.json development script(s) ${scriptList}. Their CDK deploy, destroy, or bootstrap command(s) target a development context but omit --express. ${needsUpgrade ? `First bump the aws-cdk CLI to 2.1138.0 or later (currently ${versionLabel}), then ` : ""}add --express. Do not apply express mode to production or release scripts.`,
      score: 38,
    }),
  ];
}
