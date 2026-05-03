import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  asRecord,
  hasAutomerge,
  hasExternalExtends,
  getExtends,
  findRenovateKeyLocation,
  renovateConfigPaths,
} from "../rules/shared/renovate-config.ts";
import type { WorkflowDocument } from "../workflow.ts";

const meta = {
  id: "renovate-cdk-deps-grouping",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/renovate-cdk-deps-grouping.md",
} satisfies RuleMeta;

function hasDefaultCdkGrouping(config: Record<string, unknown>): boolean {
  const presets = getExtends(config);
  const cdkGroupingPresets = [
    "config:recommended",
    "config:best-practices",
    "group:monorepos",
    "group:aws-cdkMonorepo",
  ];
  return presets.some((p) => cdkGroupingPresets.includes(p));
}

function includesCdkReference(value: unknown): boolean {
  const strings = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? [value]
      : [];
  for (const s of strings) {
    if (s === "aws-cdk-lib" || s === "constructs" || s.startsWith("@aws-cdk/")) {
      return true;
    }
    if (/aws-cdk-lib|@aws-cdk|constructs/i.test(s)) {
      return true;
    }
  }
  return false;
}

function hasCdkGrouping(config: Record<string, unknown>): boolean {
  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  for (const rule of packageRules) {
    const ruleRecord = asRecord(rule);
    if (!ruleRecord) {
      continue;
    }
    const hasGroup = ruleRecord.groupName !== undefined || ruleRecord.groupSlug !== undefined;
    if (!hasGroup) {
      continue;
    }
    const matchFields = [
      ruleRecord.matchPackageNames,
      ruleRecord.matchPackagePatterns,
      ruleRecord.matchSourceUrlPatterns,
      ruleRecord.excludePackageNames,
      ruleRecord.excludePackagePatterns,
    ];
    if (matchFields.some(includesCdkReference)) {
      return true;
    }
    const groupName = typeof ruleRecord.groupName === "string" ? ruleRecord.groupName : "";
    const groupSlug = typeof ruleRecord.groupSlug === "string" ? ruleRecord.groupSlug : "";
    if (/cdk/i.test(groupName) || /cdk/i.test(groupSlug)) {
      return true;
    }
  }
  const topGroupName = typeof config.groupName === "string" ? config.groupName : "";
  const topGroupSlug = typeof config.groupSlug === "string" ? config.groupSlug : "";
  if (/cdk/i.test(topGroupName) || /cdk/i.test(topGroupSlug)) {
    return true;
  }
  return false;
}

async function hasMultipleCdkDependencies(context: RepositoryScanContext): Promise<boolean> {
  const deps = await context.loadDependencyIndex();
  let count = 0;
  for (const dep of deps) {
    if (dep === "aws-cdk-lib" || dep === "constructs" || dep.startsWith("@aws-cdk/")) {
      count++;
      if (count >= 2) {
        return true;
      }
    }
  }
  return false;
}

export async function collectRenovateCdkDepsGroupingDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (!(await hasMultipleCdkDependencies(context))) {
    return [];
  }

  for (const relativePath of renovateConfigPaths) {
    const absolutePath = context.resolve(relativePath);
    const text = await context.readTextFileOrWarn(absolutePath);
    if (!text) {
      continue;
    }

    let config: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(text) as unknown;
      config = asRecord(parsed);
    } catch {
      continue;
    }

    if (!config) {
      continue;
    }

    if (hasAutomerge(config)) {
      return [];
    }

    if (hasExternalExtends(config)) {
      return [];
    }

    if (hasDefaultCdkGrouping(config)) {
      const deps = await context.loadDependencyIndex();
      if (!deps.has("constructs")) {
        return [];
      }
    }

    if (hasCdkGrouping(config)) {
      return [];
    }

    if (hasDefaultCdkGrouping(config)) {
      const deps = await context.loadDependencyIndex();
      if (!deps.has("constructs")) {
        return [];
      }
    }

    if (hasCdkGrouping(config)) {
      return [];
    }

    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: relativePath,
          line: 1,
          column: 1,
        },
        message: `Renovate configuration in ${relativePath} does not group CDK dependencies.`,
        why: "CDK packages release frequently and in lockstep. Without grouping, Renovate opens separate PRs for each package, multiplying CI runs and review overhead.",
        suggestion:
          "Add a packageRule that matches aws-cdk-lib, @aws-cdk/*, and constructs with a shared groupName (for example, groupName: 'cdk-dependencies').",
        measurementHint: "Count Renovate PRs per week before and after adding the group rule.",
        aiHandoff: `Update ${relativePath} to group CDK-related dependencies into a single Renovate PR while preserving existing automerge and extends behavior.`,
        score: 40,
      }),
    ];
  }

  const packageJson = await context.loadPackageJson();
  if (packageJson.value && "renovate" in packageJson.value) {
    const config = asRecord(packageJson.value.renovate);
    if (config) {
      if (hasAutomerge(config)) {
        return [];
      }
      if (hasExternalExtends(config)) {
        return [];
      }
      if (hasCdkGrouping(config)) {
        return [];
      }

      const relativePath = "package.json";
      const text = packageJson.text ?? "";
      const location = findRenovateKeyLocation(text, "renovate");

      return [
        buildRepositoryDiagnostic(repository, meta, {
          location: {
            path: relativePath,
            line: location.line,
            column: location.column,
          },
          message: `Renovate configuration in package.json does not group CDK dependencies.`,
          why: "CDK packages release frequently and in lockstep. Without grouping, Renovate opens separate PRs for each package, multiplying CI runs and review overhead.",
          suggestion:
            "Add a packageRule that matches aws-cdk-lib, @aws-cdk/*, and constructs with a shared groupName (for example, groupName: 'cdk-dependencies').",
          measurementHint: "Count Renovate PRs per week before and after adding the group rule.",
          aiHandoff:
            "Update package.json renovate configuration to group CDK-related dependencies into a single Renovate PR.",
          score: 40,
        }),
      ];
    }
  }

  return [];
}
