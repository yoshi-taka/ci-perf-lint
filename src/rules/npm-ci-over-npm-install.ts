import path from "node:path";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellCommandSegments, staticShellWords } from "./shared/command-patterns.ts";
import { workflowWorkingDirectory } from "./shared/workflow-command-context.ts";

const meta = {
  id: "prefer-npm-ci",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/npm-ci-over-npm-install.md",
} satisfies RuleMeta;

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
function isPlainNpmInstall(command: string): boolean {
  const words = staticShellWords(command);
  if (words?.[0] !== "npm" || !["install", "i"].includes(words[1] ?? "")) {
    return false;
  }
  return words
    .slice(2)
    .every((word) =>
      /^(?:--(?:ignore-scripts|no-audit|no-fund|prefer-offline|offline|legacy-peer-deps)|--(?:omit|include)=[\w,]+)$/.test(
        word,
      ),
    );
}

export const npmCiOverNpmInstallRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext): Promise<Diagnostic[]> {
    const findings: Diagnostic[] = [];
    const scan = context.scanContext;

    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        let cwd: string | undefined = workflowWorkingDirectory(workflow, job, step);
        for (const command of shellCommandSegments(step.run ?? "")) {
          const words = staticShellWords(command);
          if (!words) {
            cwd = undefined;
            continue;
          }
          if (words[0] === "cd" && words.length === 2 && words[1]) {
            cwd =
              cwd && !words[1].includes("${{")
                ? path.posix.normalize(path.posix.join(cwd, words[1]))
                : undefined;
            continue;
          }
          if (!isPlainNpmInstall(command)) {
            continue;
          }
          if (scan) {
            if (!cwd || cwd.includes("${{")) {
              continue;
            }
            const hasLock =
              (await scan.pathExists(scan.resolve(cwd, "package-lock.json"))) ||
              (await scan.pathExists(scan.resolve(cwd, "npm-shrinkwrap.json")));
            if (!hasLock) {
              continue;
            }
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
    }

    return findings;
  },
};
