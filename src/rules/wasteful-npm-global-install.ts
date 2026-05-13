import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { extractSemanticSteps } from "./shared/semantic-adapter.ts";

const npmGlobalUpdate = /\bnpm\s+(?:install|i|update|upgrade)\s+(?:-g|--global)\s+npm\b/i;
const yarnPnpmBunInstall = /\b(?:yarn\s+install|pnpm\s+install|bun\s+install)\b/i;
const npmPublish = /\bnpm\s+publish\b/i;
const npmProjectInstall = /\bnpm\s+(?:ci|install)\b/i;

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
    const steps = extractSemanticSteps(doc);

    if (steps.some((s) => npmPublish.test(s.text))) {
      return findings;
    }

    if (!steps.some((s) => yarnPnpmBunInstall.test(s.text))) {
      return findings;
    }
    if (steps.some((s) => !npmGlobalUpdate.test(s.text) && npmProjectInstall.test(s.text))) {
      return findings;
    }

    for (const step of steps) {
      const match = step.text.match(npmGlobalUpdate);
      if (!match) {
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

    return findings;
  },
};
