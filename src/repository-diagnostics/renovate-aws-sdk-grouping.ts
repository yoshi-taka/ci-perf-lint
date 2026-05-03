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
  id: "renovate-aws-sdk-grouping",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/renovate-aws-sdk-grouping.md",
} satisfies RuleMeta;

function hasDefaultAwsSdkGrouping(config: Record<string, unknown>): boolean {
  const presets = getExtends(config);
  const awsSdkGroupingPresets = ["config:recommended", "config:best-practices", "group:monorepos"];
  return presets.some((p) => awsSdkGroupingPresets.includes(p));
}

function includesAwsSdkReference(value: unknown): boolean {
  const strings = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? [value]
      : [];
  for (const s of strings) {
    if (s.startsWith("@aws-sdk/")) {
      return true;
    }
    if (/@aws-sdk\//i.test(s)) {
      return true;
    }
  }
  return false;
}

function hasAwsSdkGrouping(config: Record<string, unknown>): boolean {
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
    if (matchFields.some(includesAwsSdkReference)) {
      return true;
    }
    const groupName = typeof ruleRecord.groupName === "string" ? ruleRecord.groupName : "";
    const groupSlug = typeof ruleRecord.groupSlug === "string" ? ruleRecord.groupSlug : "";
    if (/aws[- ]?sdk/i.test(groupName) || /aws[- ]?sdk/i.test(groupSlug)) {
      return true;
    }
  }
  const topGroupName = typeof config.groupName === "string" ? config.groupName : "";
  const topGroupSlug = typeof config.groupSlug === "string" ? config.groupSlug : "";
  if (/aws[- ]?sdk/i.test(topGroupName) || /aws[- ]?sdk/i.test(topGroupSlug)) {
    return true;
  }
  return false;
}

async function hasMultipleAwsSdkDependencies(context: RepositoryScanContext): Promise<boolean> {
  const deps = await context.loadDependencyIndex();
  let count = 0;
  for (const dep of deps) {
    if (dep.startsWith("@aws-sdk/")) {
      count++;
      if (count >= 2) {
        return true;
      }
    }
  }
  return false;
}

export async function collectRenovateAwsSdkGroupingDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  if (!(await hasMultipleAwsSdkDependencies(context))) {
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

    if (hasDefaultAwsSdkGrouping(config)) {
      return [];
    }

    if (hasAwsSdkGrouping(config)) {
      return [];
    }

    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: relativePath,
          line: 1,
          column: 1,
        },
        message: `Renovate configuration in ${relativePath} does not group AWS SDK dependencies.`,
        why: "AWS SDK v3 packages are part of the same @aws-sdk monorepo and release together. Without grouping, Renovate opens separate PRs for each package, multiplying CI runs and review overhead.",
        suggestion:
          "Add a packageRule that matches @aws-sdk/* with a shared groupName (for example, groupName: 'aws-sdk-dependencies').",
        measurementHint: "Count Renovate PRs per week before and after adding the group rule.",
        aiHandoff: `Update ${relativePath} to group AWS SDK-related dependencies into a single Renovate PR while preserving existing automerge and extends behavior.`,
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
      if (hasDefaultAwsSdkGrouping(config)) {
        return [];
      }
      if (hasAwsSdkGrouping(config)) {
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
          message: `Renovate configuration in package.json does not group AWS SDK dependencies.`,
          why: "AWS SDK v3 packages are part of the same @aws-sdk monorepo and release together. Without grouping, Renovate opens separate PRs for each package, multiplying CI runs and review overhead.",
          suggestion:
            "Add a packageRule that matches @aws-sdk/* with a shared groupName (for example, groupName: 'aws-sdk-dependencies').",
          measurementHint: "Count Renovate PRs per week before and after adding the group rule.",
          aiHandoff:
            "Update package.json renovate configuration to group AWS SDK-related dependencies into a single Renovate PR.",
          score: 40,
        }),
      ];
    }
  }

  return [];
}
