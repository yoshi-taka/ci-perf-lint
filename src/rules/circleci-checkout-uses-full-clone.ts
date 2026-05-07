import type { Node } from "yaml";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CircleCiDocument, CircleCiJob } from "../circleci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "circleci-checkout-uses-full-clone",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/circleci-checkout-uses-full-clone.md",
  scope: "circleci",
} satisfies RuleMeta;

const historyDependentCommandPattern =
  /(git fetch|git pull|git rebase|git merge|git push|git describe|git diff|git log|git rev-list|git tag|commitlint|semantic-release|lerna changed|nx affected|turbo run|get-release-version|release notes|changelog|previous tag|release-it|changeset)/i;

function jobNeedsFullHistory(job: CircleCiJob): boolean {
  for (const step of job.steps) {
    if (step.type === "run" && step.command) {
      if (historyDependentCommandPattern.test(step.command)) {
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
      if (jobNeedsFullHistory(job)) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, checkoutNode, {
          message: `Job "${job.name}" uses full checkout clone but does not need git history.`,
          why: "CircleCI defaults to blobless clone, which is faster and uses less data. Explicitly requesting a full clone is only necessary when the job accesses git history (e.g. git log, git describe, commitlint, semantic-release).",
          suggestion: `Remove checkout or set checkout method to blobless (or omit method, as blobless is the default).`,
          measurementHint:
            "Full clones fetch all git history, which increases checkout time and storage.",
          aiHandoff: `Review ${doc.relativePath} job "${job.name}" - the checkout uses method: full but no step commands require git history.`,
          score: 60,
        }),
      );
    }

    return findings;
  },
};
