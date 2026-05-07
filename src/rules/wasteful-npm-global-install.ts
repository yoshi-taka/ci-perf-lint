import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const npmGlobalUpdate = /\bnpm\s+(?:install|i|update|upgrade)\s+(?:-g|--global)\s+npm\b/i;
const yarnPnpmBunInstall = /\b(?:yarn\s+install|pnpm\s+install|bun\s+install)\b/i;
const npmPublish = /\bnpm\s+publish\b/i;
const npmProjectInstall = /\bnpm\s+(?:ci|install)\b/i;

const meta = {
  id: "wasteful-npm-global-install",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/wasteful-npm-global-install.md",
  scope: "both",
} satisfies RuleMeta;

export const wastefulNpmGlobalInstallRule = {
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

    if (!entries.some((e) => yarnPnpmBunInstall.test(e.text))) {
      return findings;
    }
    if (entries.some((e) => !npmGlobalUpdate.test(e.text) && npmProjectInstall.test(e.text))) {
      return findings;
    }

    for (const entry of entries) {
      const match = entry.text.match(npmGlobalUpdate);
      if (!match) {
        continue;
      }

      findings.push(
        buildDiagnostic(workflow, meta, entry.node, {
          message: `Step "${entry.stepName}" uses yarn/pnpm/bun but also upgrades npm globally.`,
          why: "Upgrading npm globally adds unnecessary CI overhead when the project uses yarn, pnpm, or bun as its package manager. The npm version on the runner does not affect project dependency resolution or build scripts managed by these tools.",
          suggestion:
            "Remove the npm global upgrade step. yarn, pnpm, and bun manage their own dependency resolution and do not rely on the npm CLI version.",
          measurementHint:
            "Compare the step wall-clock time before and after removing the npm global upgrade step.",
          aiHandoff: `Review ${workflow.relativePath} step "${entry.stepName}" and remove the npm global upgrade step since the workflow already uses yarn/pnpm/bun for package management.`,
          score: 65,
        }),
      );
    }

    return findings;
  },
};
