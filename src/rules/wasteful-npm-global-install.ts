import type { Node } from "yaml";
import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { AnyDocument, AnyStep } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { getDocumentSteps, getStepCommandText } from "./shared/any-step.ts";

const meta = {
  id: "wasteful-npm-global-install",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/wasteful-npm-global-install.md",
  scope: "both",
} satisfies RuleMeta;

const npmGlobalUpdate = /\bnpm\s+(?:install|i|update|upgrade)\s+(?:-g|--global)\s+npm\b/i;
const yarnPnpmBunInstall = /\b(?:yarn\s+install|pnpm\s+install|bun\s+install)\b/i;
const npmPublish = /\bnpm\s+publish\b/i;
const npmProjectInstall = /\bnpm\s+(?:ci|install)\b/i;

function documentHasNpmPublish(doc: AnyDocument): boolean {
  return getDocumentSteps(doc).some((step) => npmPublish.test(getStepCommandText(step)));
}

function stepsContainYarnPnpmBun(steps: AnyStep[]): boolean {
  return steps.some((step) => yarnPnpmBunInstall.test(getStepCommandText(step)));
}

function stepsContainNpmPackageManagement(steps: AnyStep[]): boolean {
  return steps.some((step) => {
    const text = getStepCommandText(step);
    if (npmGlobalUpdate.test(text)) {
      return false;
    }
    return npmProjectInstall.test(text);
  });
}

function findNpmGlobalSteps(steps: AnyStep[]): AnyStep[] {
  return steps.filter((step) => npmGlobalUpdate.test(getStepCommandText(step)));
}

function getStepLabel(step: AnyStep): string {
  if ("name" in step) {
    return (step as { name?: string }).name ?? "unnamed";
  }
  if ("label" in step) {
    return (step as { label?: string }).label ?? "unnamed";
  }
  return "unnamed";
}

export const wastefulNpmGlobalInstallRule = {
  meta,
  check(doc: AnyDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    if (documentHasNpmPublish(doc)) {
      return findings;
    }

    const steps = getDocumentSteps(doc);
    if (!stepsContainYarnPnpmBun(steps)) {
      return findings;
    }
    if (stepsContainNpmPackageManagement(steps)) {
      return findings;
    }

    const npmGlobalSteps = findNpmGlobalSteps(steps);

    for (const step of npmGlobalSteps) {
      const commandText = getStepCommandText(step);
      const match = commandText.match(npmGlobalUpdate);
      if (!match) {
        continue;
      }

      const node = (("runNode" in step
        ? (step as { runNode?: Node }).runNode
        : "commandNode" in step
          ? (step as { commandNode?: Node }).commandNode
          : undefined) ?? step.node) as Node | undefined;

      findings.push(
        buildDiagnostic(doc, meta, node, {
          message: `Step "${getStepLabel(step)}" uses yarn/pnpm/bun but also upgrades npm globally.`,
          why: "Upgrading npm globally adds unnecessary CI overhead when the project uses yarn, pnpm, or bun as its package manager. The npm version on the runner does not affect project dependency resolution or build scripts managed by these tools.",
          suggestion:
            "Remove the npm global upgrade step. yarn, pnpm, and bun manage their own dependency resolution and do not rely on the npm CLI version.",
          measurementHint:
            "Compare the step wall-clock time before and after removing the npm global upgrade step.",
          aiHandoff: `Review ${doc.relativePath} step "${getStepLabel(step)}" and remove the npm global upgrade step since the workflow already uses yarn/pnpm/bun for package management.`,
          score: 65,
        }),
      );
    }

    return findings;
  },
};
