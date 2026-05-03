import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import {
  asRecord,
  hasAutomerge,
  hasExternalExtends,
  findRenovateKeyLocation,
  renovateConfigPaths,
} from "../rules/shared/renovate-config.ts";
import type { WorkflowDocument } from "../workflow.ts";

const meta = {
  id: "renovate-rebase-when-unconfigured",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/renovate-rebase-when-unconfigured.md",
} satisfies RuleMeta;

function hasRebaseWhen(config: Record<string, unknown>): boolean {
  if (config.rebaseWhen !== undefined) {
    return true;
  }
  const packageRules = Array.isArray(config.packageRules) ? config.packageRules : [];
  for (const rule of packageRules) {
    const ruleRecord = asRecord(rule);
    if (ruleRecord?.rebaseWhen !== undefined) {
      return true;
    }
  }
  return false;
}

export async function repositoryHasRenovateConfig(
  context: RepositoryScanContext,
): Promise<boolean> {
  for (const relativePath of renovateConfigPaths) {
    if (await context.pathExists(context.resolve(relativePath))) {
      return true;
    }
  }
  const packageJson = await context.loadPackageJson();
  if (packageJson.value && "renovate" in packageJson.value) {
    return true;
  }
  return false;
}

export async function collectRenovateRebaseWhenDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

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

    if (hasRebaseWhen(config)) {
      return [];
    }

    return [
      buildRepositoryDiagnostic(repository, meta, {
        location: {
          path: relativePath,
          line: 1,
          column: 1,
        },
        message: `Renovate configuration in ${relativePath} does not set rebaseWhen locally.`,
        why: "Without an explicit rebaseWhen policy, Renovate may trigger unnecessary CI runs through implicit rebasing behavior. Setting it explicitly reduces surprise CI waste.",
        suggestion:
          "Add an explicit rebaseWhen field to the Renovate configuration (for example, rebaseWhen: 'conflicted' or rebaseWhen: 'behind-base-branch').",
        measurementHint:
          "Monitor CI run frequency for Renovate PRs before and after adding the setting.",
        aiHandoff: `Update ${relativePath} to add an explicit rebaseWhen policy while preserving existing automerge and extends behavior.`,
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
      if (hasRebaseWhen(config)) {
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
          message: `Renovate configuration in package.json does not set rebaseWhen locally.`,
          why: "Without an explicit rebaseWhen policy, Renovate may trigger unnecessary CI runs through implicit rebasing behavior. Setting it explicitly reduces surprise CI waste.",
          suggestion:
            "Add an explicit rebaseWhen field to the Renovate configuration in package.json (for example, rebaseWhen: 'conflicted' or rebaseWhen: 'behind-base-branch').",
          measurementHint:
            "Monitor CI run frequency for Renovate PRs before and after adding the setting.",
          aiHandoff:
            "Update package.json renovate configuration to add an explicit rebaseWhen policy.",
          score: 40,
        }),
      ];
    }
  }

  return [];
}
