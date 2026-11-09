import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectInstallCommandFromText } from "./shared/tools.ts";
import { staticShellWords } from "./shared/command-patterns.ts";
import { workflowStepEnv } from "./shared/workflow-command-context.ts";
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

function getInstallScopeKey(manager: string, words: string[]): string {
  const end = words.indexOf("--");
  const args = words.slice(2, end < 0 ? undefined : end);
  const optionValue = (...names: string[]): string | undefined => {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index]!;
      if (names.includes(arg)) {
        return args[index + 1];
      }
      for (const name of names) {
        if (arg.startsWith(`${name}=`)) {
          return arg.slice(name.length + 1);
        }
      }
    }
    return undefined;
  };
  if (manager === "pnpm") {
    if (args.includes("--ignore-workspace")) {
      return "ignore-workspace";
    }
    const filter = optionValue("--filter");
    if (filter !== undefined) {
      return `filter:${filter}`;
    }
    if (args.some((arg) => ["--prod", "--production"].includes(arg))) {
      return "production";
    }
  }
  if (manager === "npm") {
    if (args.some((arg) => ["--global", "-g", "--global=true"].includes(arg))) {
      return "global";
    }
    const workspace = optionValue("--workspace", "-w");
    if (workspace !== undefined) {
      return `workspace:${workspace}`;
    }
    if (
      args.includes("--production") ||
      optionValue("--omit", "--include", "--only") !== undefined
    ) {
      return "filtered";
    }
    if (words[1] === "ci") {
      return "frozen";
    }
  }
  if (args.includes("--frozen-lockfile")) {
    return "frozen";
  }
  return "";
}

function getInstallTargetKey(manager: string, scope: string, args: string[]): string {
  if (manager !== "npm" || scope !== "global") {
    return JSON.stringify(args);
  }
  // Keep the existing registry-independent global-package review heuristic.
  // Location/other options still distinguish installations, unlike display text.
  const target: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--") {
      target.push(...args.slice(index));
      break;
    }
    if (arg === "--registry") {
      index++;
    } else if (!arg.startsWith("--registry=")) {
      target.push(arg);
    }
  }
  return JSON.stringify(target);
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
        if (!manager || ["maven", "gradle", "sbt"].includes(manager)) {
          continue;
        }

        const words = staticShellWords(step.text.trim());
        const executable = manager === "bundler" ? "bundle" : manager;
        if (!words || words[0] !== executable) {
          continue;
        }
        const isInstall =
          ["install", "ci", "sync"].includes(words[1] ?? "") ||
          (manager === "go" && words[1] === "mod" && words[2] === "download");
        if (!isInstall) {
          continue;
        }
        const scopeKey = getInstallScopeKey(manager, words);
        const targetKey = getInstallTargetKey(manager, scopeKey, words.slice(2));
        let envKey = "";
        let checkoutGeneration = 0;
        if (doc.kind === "github-actions") {
          const job = doc.jobs.find((candidate) => candidate.id === jobName);
          const original = job?.steps.find((candidate) => candidate.runNode === step.node);
          if (job && original) {
            for (const candidate of job.steps) {
              if (candidate === original) {
                break;
              }
              if (candidate.uses?.toLowerCase().startsWith("actions/checkout@")) {
                checkoutGeneration++;
              }
            }
            envKey = JSON.stringify(
              Object.entries(workflowStepEnv(doc, job, original)).sort(([a], [b]) =>
                a.localeCompare(b),
              ),
            );
          }
        }
        const compositeKey = `${manager}:${scopeKey}:${targetKey}:${step.workingDirectory ?? "."}:${envKey}:${checkoutGeneration}`;

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
