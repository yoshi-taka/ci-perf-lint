import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

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
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ) {
    const findings: Diagnostic[] = [];
    const entries = collectCommandEntries(workflow);

    if (entries.some((e) => npmPublish.test(e.text))) {
      return findings;
    }

    if (entries.some((e) => yarnPnpmBunInstall.test(e.text))) {
      return findings;
    }

    const hasGlobalUpdate = entries.some((e) => npmGlobalUpdate.test(e.text));
    const hasProjectInstall = entries.some((e) => npmProjectInstall.test(e.text));
    if (!hasGlobalUpdate || !hasProjectInstall) {
      return findings;
    }

    for (const entry of entries) {
      const match = entry.text.match(npmGlobalUpdate);
      if (!match) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, entry.node, {
          message: `Step "${entry.stepName}" upgrades npm globally before a project npm install step.`,
          why: "Upgrading npm globally immediately before running npm ci or npm install is redundant. The npm version bundled with the runner's Node.js is sufficient for dependency installation. The global upgrade adds unnecessary wall-clock time without improving reproducibility or correctness.",
          suggestion:
            "Remove the npm global upgrade step. npm ci or npm install will use the npm version bundled with the runner's Node.js.",
          measurementHint:
            "Compare the step wall-clock time before and after removing the npm global upgrade step.",
          aiHandoff: `Review ${workflow.relativePath} step "${entry.stepName}" and remove the npm global upgrade step since the workflow already runs npm ci or npm install afterward.`,
          score: 60,
        }),
      );
    }

    return findings;
  },
};
