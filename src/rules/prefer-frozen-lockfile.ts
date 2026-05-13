import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const meta = {
  id: "prefer-frozen-lockfile",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/prefer-frozen-lockfile.md",
  scope: "all",
} satisfies RuleMeta;

const MANAGER_PATTERNS = {
  pnpm: {
    install: /\bpnpm\s+(install|i)\b/i,
    frozen: /\bpnpm\s+(ci|install\s+--frozen-lockfile)\b/i,
  },
  yarn: {
    install: /\byarn\s+(install|i)\b/i,
    frozen: /\byarn\s+install\s+--(frozen-lockfile|immutable)\b/i,
  },
  bun: { install: /\bbun\s+(install|i)\b/i, frozen: /\bbun\s+(ci|install\s+--frozen-lockfile)\b/i },
} as const;

function detectManager(run: string): keyof typeof MANAGER_PATTERNS | null {
  for (const manager of Object.keys(MANAGER_PATTERNS) as (keyof typeof MANAGER_PATTERNS)[]) {
    if (MANAGER_PATTERNS[manager].install.test(run)) {
      return manager;
    }
  }
  return null;
}

function isGithubActionsDoc(
  doc: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
): doc is WorkflowDocument {
  return "jobs" in doc && !("kind" in doc);
}

function checkGithubActions(workflow: WorkflowDocument): Diagnostic[] {
  const findings: Diagnostic[] = [];

  for (const job of workflow.jobs) {
    for (const step of job.steps) {
      const run = step.run ?? "";
      const manager = detectManager(run);
      if (!manager) {
        continue;
      }

      const frozen = MANAGER_PATTERNS[manager].frozen.test(run);
      if (frozen) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
          message: `Job "${job.id}" uses ${manager} without a frozen lockfile flag.`,
          why: `Using ${manager} without --frozen-lockfile (or equivalent) allows the install to update or drift from the committed lockfile. This adds resolution time and risks reproducibility issues in CI.`,
          suggestion: `Use ${manager === "pnpm" ? "pnpm ci" : manager === "yarn" ? "yarn install --immutable or yarn install --frozen-lockfile" : "bun ci or bun install --frozen-lockfile"}.`,
          measurementHint:
            "Compare install step duration before and after adding frozen lockfile flag.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and use the frozen lockfile flag for ${manager}.`,
          score: 55,
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

  for (const entry of entries) {
    const manager = detectManager(entry.text);
    if (!manager) {
      continue;
    }

    const frozen = MANAGER_PATTERNS[manager].frozen.test(entry.text);
    if (frozen) {
      continue;
    }

    findings.push(
      buildDiagnostic(doc, meta, entry.node, {
        message: `Job "${entry.jobName}" uses ${manager} without a frozen lockfile flag.`,
        why: `Using ${manager} without --frozen-lockfile (or equivalent) allows the install to update or drift from the committed lockfile. This adds resolution time and risks reproducibility issues in CI.`,
        suggestion: `Use ${manager === "pnpm" ? "pnpm ci" : manager === "yarn" ? "yarn install --immutable or yarn install --frozen-lockfile" : "bun ci or bun install --frozen-lockfile"}.`,
        measurementHint:
          "Compare install step duration before and after adding frozen lockfile flag.",
        aiHandoff: `Review ${doc.relativePath} job "${entry.jobName}" and use the frozen lockfile flag for ${manager}.`,
        score: 55,
      }),
    );
  }

  return findings;
}

export const preferFrozenLockfileRule = {
  meta,
  check(
    doc: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ): Diagnostic[] {
    if (isGithubActionsDoc(doc)) {
      return checkGithubActions(doc);
    }
    return checkCrossPlatform(doc);
  },
};
