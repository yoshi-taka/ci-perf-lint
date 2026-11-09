import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";
import {
  isNpmGlobalUpgrade,
  isAlternativePackageInstall,
  isProjectNpmInstall,
} from "./shared/npm-global-commands.ts";

const meta = {
  id: "unnecessary-npm-global-upgrade-before-npm-install",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/unnecessary-npm-global-upgrade-before-npm-install.md",
  scope: "all",
} satisfies RuleMeta;

export const unnecessaryNpmGlobalUpgradeBeforeNpmInstallRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const steps = extractSemanticSteps(doc);

    const commands = steps.flatMap((step) => shellInvocations(step.text, false));
    if (commands.some(([tool, action]) => tool === "npm" && action === "publish")) {
      return findings;
    }

    if (commands.some(isAlternativePackageInstall)) {
      return findings;
    }

    const hasGlobalUpdate = commands.some(isNpmGlobalUpgrade);
    const hasProjectInstall = commands.some(isProjectNpmInstall);
    if (!hasGlobalUpdate || !hasProjectInstall) {
      return findings;
    }

    for (const step of steps) {
      if (!shellInvocations(step.text, false).some(isNpmGlobalUpgrade)) {
        continue;
      }

      findings.push(
        buildDiagnostic(doc, meta, step.node, {
          message: `Step "${step.stepName}" upgrades npm globally before a project npm install step.`,
          why: "Upgrading npm globally immediately before running npm ci or npm install is redundant. The npm version bundled with the runner's Node.js is sufficient for dependency installation. The global upgrade adds unnecessary wall-clock time without improving reproducibility or correctness.",
          suggestion:
            "Remove the npm global upgrade step. npm ci or npm install will use the npm version bundled with the runner's Node.js.",
          measurementHint:
            "Compare the step wall-clock time before and after removing the npm global upgrade step.",
          aiHandoff: `Review ${doc.relativePath} step "${step.stepName}" and remove the npm global upgrade step since the workflow already runs npm ci or npm install afterward.`,
          score: 60,
        }),
      );
    }

    return findings;
  },
};
