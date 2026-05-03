import type { AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { WorkflowDocument } from "../workflow.ts";
import path from "node:path";
import { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";

const meta = {
  id: "terraform-pagerduty-team-membership-version",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/terraform-pagerduty-team-membership-version.md",
} satisfies RuleMeta;

const PAGERDUTY_PROVIDER_RE =
  /(?:provider\s+"pagerduty"|required_providers\s*\{[^}]*\bpagerduty\b)|resource\s+"pagerduty_|data\s+"pagerduty_/;

const TEAM_MEMBERSHIP_RESOURCE_RE = /resource\s+"pagerduty_team_membership"/g;

function constraintEnsuresMin3322(versionStr: string): boolean {
  const geMatch = versionStr.match(/>=\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (geMatch) {
    const major = parseInt(geMatch[1]!),
      minor = parseInt(geMatch[2]!),
      patch = parseInt(geMatch[3] ?? "0");
    if (major > 3) {
      return true;
    }
    if (major === 3 && minor > 32) {
      return true;
    }
    if (major === 3 && minor === 32 && patch >= 2) {
      return true;
    }
    return false;
  }

  const twMatch = versionStr.match(/~>\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (twMatch) {
    const major = parseInt(twMatch[1]!),
      minor = parseInt(twMatch[2]!),
      patch = parseInt(twMatch[3] ?? "0");
    if (major > 3) {
      return true;
    }
    if (major === 3 && minor > 32) {
      return true;
    }
    if (major === 3 && minor === 32 && patch >= 2) {
      return true;
    }
    return false;
  }

  const gtMatch = versionStr.match(/>\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (gtMatch) {
    const major = parseInt(gtMatch[1]!),
      minor = parseInt(gtMatch[2]!);
    let patch = parseInt(gtMatch[3] ?? "0");
    patch += 1;
    if (major > 3) {
      return true;
    }
    if (major === 3 && minor > 32) {
      return true;
    }
    if (major === 3 && minor === 32 && patch >= 2) {
      return true;
    }
    return false;
  }

  const exactMatch = versionStr.match(/"\s*(\d+)\.(\d+)\.(\d+)\s*"/);
  if (exactMatch) {
    const major = parseInt(exactMatch[1]!),
      minor = parseInt(exactMatch[2]!),
      patch = parseInt(exactMatch[3]!);
    if (major > 3) {
      return true;
    }
    if (major === 3 && minor > 32) {
      return true;
    }
    if (major === 3 && minor === 32 && patch >= 2) {
      return true;
    }
    return false;
  }

  return false;
}

export async function collectTerraformPagerDutyTeamMembershipVersionDiagnostics(
  repoRoot: string,
  repository: RepositorySignals,
  _workflows: WorkflowDocument[],
  warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const context = scanContext ?? new RepositoryScanContext(repoRoot, warnings ?? []);

  let usesPagerDutyProvider = false;
  let usesTeamMembership = false;
  let versionOk = false;
  const tfFiles: { relativePath: string; content: string }[] = [];

  for await (const tfPath of context.walkFilesIter(".", {
    ignoredDirectories: new Set([".git", "node_modules", ".terraform"]),
    include: (candidatePath) => candidatePath.endsWith(".tf"),
  })) {
    const fullPath = path.join(repoRoot, tfPath);
    const content = await context.readTextFileOrWarn(fullPath);
    if (!content) {
      continue;
    }

    tfFiles.push({ relativePath: tfPath, content });

    if (!usesPagerDutyProvider && PAGERDUTY_PROVIDER_RE.test(content)) {
      usesPagerDutyProvider = true;
    }

    if (!usesTeamMembership && /resource\s+"pagerduty_team_membership"/.test(content)) {
      usesTeamMembership = true;
    }

    if (usesPagerDutyProvider && !versionOk) {
      const versionPatterns = [
        /required_providers\s*\{[\s\S]*?pagerduty\s*=\s*\{[\s\S]*?version\s*=\s*("[^"]+")/g,
        /provider\s+"pagerduty"\s*\{[\s\S]*?version\s*=\s*("[^"]+")/g,
      ];

      for (const re of versionPatterns) {
        for (const m of content.matchAll(re)) {
          if (constraintEnsuresMin3322(m[1]!)) {
            versionOk = true;
            break;
          }
        }
        if (versionOk) {
          break;
        }
      }
    }
  }

  if (!usesPagerDutyProvider || !usesTeamMembership) {
    return [];
  }

  if (versionOk) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const teamMembershipRe = new RegExp(TEAM_MEMBERSHIP_RESOURCE_RE.source, "g");

  for (const { relativePath, content } of tfFiles) {
    teamMembershipRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = teamMembershipRe.exec(content)) !== null) {
      const line = content.slice(0, match.index).split("\n").length;

      diagnostics.push(
        buildRepositoryDiagnostic(repository, meta, {
          location: { path: relativePath, line, column: 1 },
          message:
            "PagerDuty provider is not constrained to >= v3.32.2 while pagerduty_team_membership is used.",
          why: "PagerDuty provider v3.32.2 fixed a bug (#318) that caused repeated, unnecessary API calls when reading pagerduty_team_membership resources. Versions below v3.32.2 make extra API requests per team membership, slowing down terraform plan and apply.",
          suggestion:
            'Update the PagerDuty provider version constraint to ">= 3.32.2" or "~> 3.32.2" in required_providers, then run terraform init -upgrade.',
          measurementHint:
            "Compare terraform plan duration before and after upgrading the PagerDuty provider version.",
          aiHandoff: `In ${relativePath}, update the PagerDuty provider version constraint in required_providers to >= 3.32.2. Run terraform init -upgrade afterward. Preserve all other provider and resource configuration.`,
          score: 60,
        }),
      );
    }
  }

  return diagnostics;
}
