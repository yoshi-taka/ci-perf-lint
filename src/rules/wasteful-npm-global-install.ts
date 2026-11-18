import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { getNode } from "../workflow.ts";
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

const provenanceEnvPattern = /NPM_CONFIG_PROVENANCE/i;
const idTokenWritePattern = /["']?id-token["']?\s*:\s*["']?write["']?/i;

function envText(map: Parameters<typeof getNode>[0] | undefined): string {
  const env = map === undefined ? undefined : getNode(map, "env")?.toJSON();
  return env && typeof env === "object" ? JSON.stringify(env) : "";
}

function permissionsText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

function jobHasTrustedPublishingEvidence(workflow: WorkflowDocument, job: WorkflowJob): boolean {
  if (provenanceEnvPattern.test(envText(job.node))) {
    return true;
  }
  if (workflow.root !== undefined && provenanceEnvPattern.test(envText(workflow.root))) {
    return true;
  }

  const jobPermissions = getNode(job.node, "permissions")?.toJSON();
  const workflowPermissions =
    workflow.root !== undefined
      ? getNode(workflow.root, "permissions")?.toJSON()
      : workflow.parsed?.permissions;
  if (
    idTokenWritePattern.test(permissionsText(jobPermissions)) ||
    idTokenWritePattern.test(permissionsText(workflowPermissions))
  ) {
    return true;
  }

  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    if (
      uses.startsWith("actions/setup-node@") &&
      typeof step.with?.["registry-url"] === "string" &&
      step.with["registry-url"].trim().length > 0
    ) {
      return true;
    }
    return provenanceEnvPattern.test(envText(step.node)) || /--provenance\b/.test(step.run ?? "");
  });
}

export const wastefulNpmGlobalInstallRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const workflow = doc.kind === "github-actions" ? doc : undefined;
    for (const [jobName, steps] of groupStepsByJob(extractSemanticSteps(doc)).entries()) {
      const commands = steps.flatMap((step) => shellInvocations(step.text, false));
      if (!commands.some(isAlternativePackageInstall)) {
        continue;
      }
      // npm can be a compatibility-test client or tool installer even when root deps use Yarn.
      if (commands.some((words) => words[0] === "npm" && !isNpmGlobalUpgrade(words))) {
        continue;
      }
      // Upgrading npm globally is a documented requirement for OIDC trusted
      // publishing (npm 11.5.1+ for --provenance) and for private-registry
      // publication; those jobs are not wasting CI time.
      if (
        workflow !== undefined &&
        commands.some(isNpmGlobalUpgrade) &&
        workflow.jobs.some(
          (job) => job.id === jobName && jobHasTrustedPublishingEvidence(workflow, job),
        )
      ) {
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
