import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";

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

export const preferFrozenLockfileRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const steps = extractSemanticSteps(doc);

    for (const step of steps) {
      const manager = detectManager(step.text);
      if (!manager) {
        continue;
      }

      const frozen = MANAGER_PATTERNS[manager].frozen.test(step.text);
      if (frozen) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, step.node, {
          message: `Job "${step.jobName}" uses ${manager} without a frozen lockfile flag.`,
          why: `Using ${manager} without --frozen-lockfile (or equivalent) allows the install to update or drift from the committed lockfile. This adds resolution time and risks reproducibility issues in CI.`,
          suggestion: `Use ${manager === "pnpm" ? "pnpm ci" : manager === "yarn" ? "yarn install --immutable or yarn install --frozen-lockfile" : "bun ci or bun install --frozen-lockfile"}.`,
          measurementHint:
            "Compare install step duration before and after adding frozen lockfile flag.",
          aiHandoff: `Review ${doc.relativePath} job "${step.jobName}" and use the frozen lockfile flag for ${manager}.`,
          score: 55,
        }),
      );
    }

    return findings;
  },
};
