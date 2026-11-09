import type { Node } from "../yaml.ts";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CircleCiDocument, CircleCiJob } from "../circleci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import {
  textHasHistoryDependentExecution,
  textHasOpaqueRepositoryExecution,
} from "./shared/repository-command-evidence.ts";
import { staticShellWords } from "./shared/command-patterns.ts";

const meta = {
  id: "circleci-checkout-uses-full-clone",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/circleci-checkout-uses-full-clone.md",
  scope: "circleci",
} satisfies RuleMeta;

const modeledSteps = new Set([
  "checkout",
  "run",
  "save_cache",
  "restore_cache",
  "store_artifacts",
  "store_test_results",
  "persist_to_workspace",
  "attach_workspace",
  "add_ssh_keys",
  "setup_remote_docker",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isModeledShell(shell: unknown): boolean {
  if (shell === undefined) {
    return true;
  }
  if (typeof shell !== "string") {
    return false;
  }
  const words = staticShellWords(shell);
  return Boolean(
    words?.length &&
    ["bash", "sh", "/bin/bash", "/bin/sh", "/usr/bin/bash", "/usr/bin/sh"].includes(words[0]!) &&
    words
      .slice(1)
      .every(
        (word) => /^-[euxo]+$/.test(word) || ["pipefail", "errexit", "nounset"].includes(word),
      ),
  );
}

function jobHasUnresolvedCheckoutNeeds(doc: CircleCiDocument, job: CircleCiJob): boolean {
  const raw = asRecord(asRecord(doc.parsed?.jobs)[job.name]);
  // Executor/orb commands and conditional command bodies are not expanded by this rule.
  if (raw.executor !== undefined || !isModeledShell(raw.shell)) {
    return true;
  }
  if (
    Array.isArray(raw.steps) &&
    raw.steps.some((step) => {
      const type = typeof step === "string" ? step : Object.keys(asRecord(step))[0];
      return !type || !modeledSteps.has(type);
    })
  ) {
    return true;
  }
  for (const step of job.steps) {
    if (!modeledSteps.has(step.type)) {
      return true;
    }
    if (step.type === "run") {
      if (
        !step.command ||
        !isModeledShell(step.shell) ||
        (step.shell === undefined && /^win(?:dows)?[/.]/i.test(job.resourceClass ?? "")) ||
        textHasHistoryDependentExecution(step.command) ||
        textHasOpaqueRepositoryExecution(step.command)
      ) {
        return true;
      }
    }
  }
  return false;
}

export const circleciCheckoutUsesFullCloneRule = {
  meta,
  check(doc: CircleCiDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of doc.jobs) {
      let usesFullClone = false;
      let checkoutNode: Node | undefined;

      for (const step of job.steps) {
        if (step.type === "checkout" && step.checkoutMethod === "full") {
          usesFullClone = true;
          checkoutNode = step.checkoutMethodNode ?? step.node;
        }
      }

      if (!usesFullClone) {
        continue;
      }
      if (jobHasUnresolvedCheckoutNeeds(doc, job)) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, checkoutNode, {
          message: `Job "${job.name}" explicitly requests a full checkout without a visible need for eager historical file blobs.`,
          why: "A blobless clone retains commit and tree metadata but fetches file contents lazily. A full clone downloads historical file blobs eagerly, which can add transfer time and storage. No visible command establishes that this job needs those blobs downloaded up front.",
          suggestion:
            "Keep the checkout step. If the job supports lazy blob fetching, test method: blobless (or omit method) and verify the same tools and repository-file operations still work.",
          measurementHint:
            "Compare checkout transfer size, lazy blob fetches, and total job time with the same commit history and checkout contents.",
          aiHandoff: `Review ${doc.relativePath} job "${job.name}" and test whether method: blobless avoids eager historical blob transfer. Preserve the checkout step and verify all repository-file and history operations.`,
          score: 60,
        }),
      );
    }

    return findings;
  },
};
