import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommand } from "./shared/tools.ts";

const meta = {
  id: "repeated-install-in-same-job",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/repeated-install-in-same-job.md",
} satisfies RuleMeta;

function parseNpmGlobalPackageNames(run: string): string[] {
  const globalRegex = /(?:\s|^)-g\b(?!\w)|(?:\s|^)--global\b/i;
  const match = globalRegex.exec(run);
  if (!match) {
    return [];
  }

  const after = run.slice(match.index + match[0].length).trim();
  const packages: string[] = [];
  const parts = after.split(/\s+/);
  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (part.startsWith("--")) {
      break;
    }
    if (/^-[a-zA-Z]$/.test(part)) {
      continue;
    }
    if (/^https?:\/\//.test(part)) {
      continue;
    }
    packages.push(part);
  }
  packages.sort();
  return packages;
}

function getInstallScopeKey(manager: string, run: string): string {
  if (manager === "pnpm") {
    if (/(?:^|\s)--ignore-workspace\b/i.test(run)) {
      return "ignore-workspace";
    }
    const filterMatch = run.match(/(?:^|\s)--filter\s+(\S+)/i);
    if (filterMatch) {
      return `filter:${filterMatch[1]}`;
    }
    if (/(?:^|\s)--prod\b|(?:^|\s)--production\b/i.test(run)) {
      return "production";
    }
  }
  if (manager === "npm") {
    if (/(?:^|\s)--global\b|(?:\s|^)-g\b(?!\w)/i.test(run)) {
      const pkgs = parseNpmGlobalPackageNames(run);
      return pkgs.length > 0 ? `global:${pkgs.join(",")}` : "global";
    }
    const wsMatch = run.match(/(?:^|\s)--workspace\s+(\S+)|(?:\s|^)-w\s+(\S+)/i);
    if (wsMatch) {
      return `workspace:${wsMatch[1] ?? wsMatch[2]}`;
    }
    if (
      /(?:^|\s)--omit=\S+|(?:^|\s)--include=\S+|(?:^|\s)--production\b|(?:^|\s)--only=\S+/i.test(
        run,
      )
    ) {
      return "filtered";
    }
    if (/\bnpm\s+ci\b/i.test(run)) {
      return "frozen";
    }
  }
  if (/--frozen-lockfile\b/i.test(run)) {
    return "frozen";
  }
  return "";
}

export const repeatedInstallInSameJobRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const seen = new Map<string, { index: number; wd: string | undefined }[]>();

      for (let i = 0; i < job.steps.length; i++) {
        const step = job.steps[i];
        if (!step) {
          continue;
        }
        if (!step.run) {
          continue;
        }

        const manager = detectInstallCommand(step);
        if (!manager) {
          continue;
        }

        const scopeKey = getInstallScopeKey(manager, step.run);
        const compositeKey = scopeKey ? `${manager}:${scopeKey}` : manager;

        const entries = seen.get(compositeKey) ?? [];
        entries.push({ index: i, wd: step.workingDirectory });
        seen.set(compositeKey, entries);
      }

      for (const [compositeKey, entries] of seen) {
        if (entries.length < 2) {
          continue;
        }

        const uniqueWorkingDirs = new Set(entries.map((e) => e.wd));
        if (uniqueWorkingDirs.size > 1) {
          continue;
        }

        const manager = compositeKey.split(":")[0]!;
        const firstEntry = entries[0];
        if (!firstEntry) {
          continue;
        }
        const firstStep = job.steps[firstEntry.index];
        if (!firstStep) {
          continue;
        }
        findings.push(
          buildDiagnostic(workflow, meta, firstStep.runNode ?? firstStep.node, {
            message: `Job "${job.id}" runs ${manager} install ${entries.length} times across steps ${entries.map((e) => `#${e.index + 1}`).join(", ")}.`,
            why: "Each install re-resolves dependencies, restores or rebuilds the dependency tree, and writes lock files or metadata. If the install output is not consumed between calls, later installs repeat the same work without adding value.",
            suggestion:
              "Remove duplicate install commands that do not consume different lock files or target different environments, or consolidate them into a single install step before the steps that actually use the dependencies.",
            measurementHint:
              "Compare total job wall-clock time and runner minutes before and after removing one of the duplicate install steps.",
            aiHandoff: `Review job "${job.id}" in ${workflow.relativePath} which runs ${manager} install ${entries.length} times. Remove extra installs that serve no separate dependency set.`,
            score: 74,
          }),
        );
      }
    }

    return findings;
  },
};
