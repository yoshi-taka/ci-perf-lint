import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";

const npmGlobalUpdate = /\bnpm\s+(?:install|i|update|upgrade)\s+(?:-g|--global)\s+npm\b/i;
const npmProjectInstall = /\bnpm\s+(?:ci|install)\b/i;
const npmPublish = /\bnpm\s+publish\b/i;
const yarnPnpmBunInstall = /\b(?:yarn\s+install|pnpm\s+install|bun\s+install)\b/i;

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

    if (steps.some((s) => npmPublish.test(s.text))) {
      return findings;
    }

    if (steps.some((s) => yarnPnpmBunInstall.test(s.text))) {
      return findings;
    }

    const hasGlobalUpdate = steps.some((s) => npmGlobalUpdate.test(s.text));
    const hasProjectInstall = steps.some((s) => npmProjectInstall.test(s.text));
    if (!hasGlobalUpdate || !hasProjectInstall) {
      return findings;
    }

    for (const step of steps) {
      const match = step.text.match(npmGlobalUpdate);
      if (!match) {
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
