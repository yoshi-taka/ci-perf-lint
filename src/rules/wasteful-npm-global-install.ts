import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps, groupStepsByJob } from "./shared/semantic-adapter.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";
import { isNpmGlobalUpgrade, isAlternativePackageInstall } from "./shared/npm-global-commands.ts";

const meta = {
  id: "wasteful-npm-global-install",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/wasteful-npm-global-install.md",
  scope: "all",
} satisfies RuleMeta;

export const wastefulNpmGlobalInstallRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    for (const steps of groupStepsByJob(extractSemanticSteps(doc)).values()) {
      const commands = steps.flatMap((step) => shellInvocations(step.text, false));
      if (!commands.some(isAlternativePackageInstall)) {
        continue;
      }
      // npm can be a compatibility-test client or tool installer even when root deps use Yarn.
      if (commands.some((words) => words[0] === "npm" && !isNpmGlobalUpgrade(words))) {
        continue;
      }
      for (const step of steps) {
        if (!shellInvocations(step.text, false).some(isNpmGlobalUpgrade)) {
          continue;
        }

        findings.push(
          buildDiagnostic(doc, meta, step.node, {
            message: `Step "${step.stepName}" uses yarn/pnpm/bun but also upgrades npm globally.`,
            why: "Upgrading npm globally adds unnecessary CI overhead when the project uses yarn, pnpm, or bun as its package manager. The npm version on the runner does not affect project dependency resolution or build scripts managed by these tools.",
            suggestion:
              "Remove the npm global upgrade step. yarn, pnpm, and bun manage their own dependency resolution and do not rely on the npm CLI version.",
            measurementHint:
              "Compare the step wall-clock time before and after removing the npm global upgrade step.",
            aiHandoff: `Review ${doc.relativePath} step "${step.stepName}" and remove the npm global upgrade step since the workflow already uses yarn/pnpm/bun for package management.`,
            score: 65,
          }),
        );
      }
    }

    return findings;
  },
};
