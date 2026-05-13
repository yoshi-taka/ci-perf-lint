import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";

const meta = {
  id: "prefer-npm-ci",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/npm-ci-over-npm-install.md",
} satisfies RuleMeta;

const npmInstallPattern = /\bnpm\s+(?:install|i)\b/i;
const npmCiPattern = /\bnpm\s+ci\b/i;
const packageLockOnlyPattern = /\b--package-lock-only\b/i;
const dryRunPattern = /\b--dry-run\b/i;

/**
 * Is this step a plain "npm install" (no specific packages) that
 * should be "npm ci" instead?
 *
 * Excludes:
 * - npm ci                         (already correct)
 * - npm install --package-lock-only (lockfile management, not install)
 * - npm install --dry-run           (verification only)
 * - npm install <package>...        (adding dependencies, not just installing)
 */
function isPlainNpmInstall(run: string): boolean {
  if (!npmInstallPattern.test(run)) {
    return false;
  }
  if (npmCiPattern.test(run)) {
    return false;
  }
  if (packageLockOnlyPattern.test(run) || dryRunPattern.test(run)) {
    return false;
  }

  // Extract the part after "install" or "i" and check for non-flag tokens
  const match = run.match(/\b(?:install|i)\s*(.*)/i);
  if (!match?.[1]) {
    return true; // bare "npm install" → should be "npm ci"
  }

  const rest = match[1];
  const tokens = rest.trim().split(/\s+/);
  // If every remaining token starts with -, it's just flags → should be "npm ci"
  // If any token doesn't start with -, it's a package name → NOT flagged
  return tokens.every((t) => t.startsWith("-"));
}

export const npmCiOverNpmInstallRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const run = step.run ?? "";
        if (!isPlainNpmInstall(run)) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" uses "npm install" instead of "npm ci".`,
            why: "npm ci is faster and deterministic for CI. It installs exactly what is in package-lock.json without modifying it, while npm install may update the lock file and re-resolve dependencies.",
            suggestion:
              'Replace "npm install" with "npm ci" when a package-lock.json exists in the repository.',
            measurementHint:
              "Compare total job duration before and after switching from npm install to npm ci.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and replace "npm install" with "npm ci" while preserving unrelated flags.`,
            score: 60,
          }),
        );
      }
    }

    return findings;
  },
};
