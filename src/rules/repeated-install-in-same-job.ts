import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommand, detectInstallCommandFromText } from "./shared/tools.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const meta = {
  id: "repeated-install-in-same-job",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/repeated-install-in-same-job.md",
  scope: "both",
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

function isGithubActionsDoc(
  doc: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
): doc is WorkflowDocument {
  return "jobs" in doc && !("kind" in doc);
}

function checkGithubActions(workflow: WorkflowDocument): Diagnostic[] {
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
}

function checkCrossPlatform(
  doc: PipelineDocument | CircleCiDocument | GitlabCiDocument,
): Diagnostic[] {
  const findings: Diagnostic[] = [];
  const entries = collectCommandEntries(doc);

  const jobGroups = new Map<
    string,
    { text: string; index: number; node: (typeof entries)[0]["node"] }[]
  >();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const group = jobGroups.get(entry.jobName) ?? [];
    group.push({ text: entry.text, index: i, node: entry.node });
    jobGroups.set(entry.jobName, group);
  }

  for (const [jobName, jobEntries] of jobGroups) {
    const seen = new Map<string, number[]>();

    for (let i = 0; i < jobEntries.length; i++) {
      const je = jobEntries[i]!;
      const manager = detectInstallCommandFromText(je.text);
      if (!manager) {
        continue;
      }

      const scopeKey = getInstallScopeKey(manager, je.text);
      const compositeKey = scopeKey ? `${manager}:${scopeKey}` : manager;

      const indices = seen.get(compositeKey) ?? [];
      indices.push(i);
      seen.set(compositeKey, indices);
    }

    for (const [compositeKey, indices] of seen) {
      if (indices.length < 2) {
        continue;
      }

      const manager = compositeKey.split(":")[0]!;
      const firstJe = jobEntries[indices[0]!]!;
      findings.push(
        buildDiagnostic(doc, meta, firstJe.node, {
          message: `Job "${jobName}" runs ${manager} install ${indices.length} times across steps ${indices.map((i) => `#${i + 1}`).join(", ")}.`,
          why: "Each install re-resolves dependencies, restores or rebuilds the dependency tree, and writes lock files or metadata. If the install output is not consumed between calls, later installs repeat the same work without adding value.",
          suggestion:
            "Remove duplicate install commands that do not consume different lock files or target different environments, or consolidate them into a single install step before the steps that actually use the dependencies.",
          measurementHint:
            "Compare total job wall-clock time and runner minutes before and after removing one of the duplicate install steps.",
          aiHandoff: `Review job "${jobName}" in ${doc.relativePath} which runs ${manager} install ${indices.length} times. Remove extra installs that serve no separate dependency set.`,
          score: 74,
        }),
      );
    }
  }

  return findings;
}

export const repeatedInstallInSameJobRule = {
  meta,
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ): Diagnostic[] {
    if (isGithubActionsDoc(workflow)) {
      return checkGithubActions(workflow);
    }
    return checkCrossPlatform(workflow);
  },
};
