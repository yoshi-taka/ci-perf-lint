import path from "node:path";
import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  cdkCliVersionIsBelowHotswapFloor,
  formatSemver,
  readCdkCliVersionFromScanContext,
  textUsesCdkHotswap,
} from "../rules/shared/cdk-express.ts";

const meta = {
  id: "prefer-aws-cdk-cli-2-1125-for-hotswap",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/prefer-aws-cdk-cli-2-1125-for-hotswap.md",
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

export async function collectPackageJsonCdkHotswapVersionDiagnostics(
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
    ([, scriptCommand]) => typeof scriptCommand === "string" && textUsesCdkHotswap(scriptCommand),
  );
  if (offendingScripts.length === 0) {
    return [];
  }

  const version = await readCdkCliVersionFromScanContext(context);
  if (!cdkCliVersionIsBelowHotswapFloor(version)) {
    return [];
  }

  const versionLabel = formatSemver(version!);
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
      message: `package.json script(s) use CDK hotswap with aws-cdk ${versionLabel}, which predates the Cloud Control API hotswap engine: ${scriptList}.`,
      why: "CDK CLI 2.1116.0-2.1125.0 added a Cloud Control API based hotswap engine, asset rebundling only when assets change, and synchronization against the last hotswap deployment. Together these cut hotswap deployment time by at least 25% and broaden the resource types hotswap can update.",
      suggestion:
        "Upgrade the aws-cdk CLI to 2.1125.0 or later to get the Cloud Control API hotswap engine and asset rebundling improvements.",
      measurementHint:
        "Compare hotswap deployment duration and the set of resources that hotswap can update before and after the CLI upgrade.",
      aiHandoff: `Review package.json script(s) ${scriptList}. They use CDK hotswap on aws-cdk ${versionLabel}, below the 2.1125.0 release that completes the faster hotswap engine. Bump the aws-cdk CLI dependency and keep unrelated dependency changes out of the bump.`,
      score: 32,
    }),
  ];
}
