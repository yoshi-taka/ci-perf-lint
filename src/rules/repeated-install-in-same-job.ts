import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommandFromText } from "./shared/tools.ts";
import {
  extractSemanticSteps,
  groupStepsByJob,
  type SemanticStep,
} from "./shared/semantic-adapter.ts";

const meta = {
  id: "repeated-install-in-same-job",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/repeated-install-in-same-job.md",
  scope: "all",
} satisfies RuleMeta;

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
      const globalRegex = /(?:\s|^)-g\b(?!\w)|(?:\s|^)--global\b/i;
      const match = globalRegex.exec(run);
      if (!match) {
        return "global";
      }
      const after = run.slice(match.index + match[0].length).trim();
      const packages: string[] = [];
      for (const part of after.split(/\s+/)) {
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
      return packages.length > 0 ? `global:${packages.sort().join(",")}` : "global";
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
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const steps = extractSemanticSteps(doc);
    const jobGroups = groupStepsByJob(steps);

    for (const [jobName, jobSteps] of jobGroups) {
      const seen = new Map<string, { step: SemanticStep; index: number }[]>();

      for (let i = 0; i < jobSteps.length; i++) {
        const step = jobSteps[i]!;
        if (step.commandType !== "install") {
          continue;
        }

        const manager = detectInstallCommandFromText(step.text);
        if (!manager) {
          continue;
        }

        const scopeKey = getInstallScopeKey(manager, step.text);
        const compositeKey = scopeKey ? `${manager}:${scopeKey}` : manager;

        const entries = seen.get(compositeKey) ?? [];
        entries.push({ step, index: i });
        seen.set(compositeKey, entries);
      }

      for (const [compositeKey, entries] of seen) {
        if (entries.length < 2) {
          continue;
        }

        const uniqueWorkingDirs = new Set(entries.map((e) => e.step.workingDirectory));
        if (uniqueWorkingDirs.size > 1) {
          continue;
        }

        const manager = compositeKey.split(":")[0]!;
        const first = entries[0]!;
        findings.push(
          buildDiagnostic(doc, meta, first.step.node, {
            message: `Job "${jobName}" runs ${manager} install ${entries.length} times across steps ${entries.map((e) => `#${e.index + 1}`).join(", ")}.`,
            why: "Each install re-resolves dependencies, restores or rebuilds the dependency tree, and writes lock files or metadata. If the install output is not consumed between calls, later installs repeat the same work without adding value.",
            suggestion:
              "Remove duplicate install commands that do not consume different lock files or target different environments, or consolidate them into a single install step before the steps that actually use the dependencies.",
            measurementHint:
              "Compare total job wall-clock time and runner minutes before and after removing one of the duplicate install steps.",
            aiHandoff: `Review ${doc.relativePath} job "${jobName}" which runs ${manager} install ${entries.length} times. Remove extra installs that serve no separate dependency set.`,
            score: 74,
          }),
        );
      }
    }

    return findings;
  },
};
