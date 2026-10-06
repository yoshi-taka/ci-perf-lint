import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { sourceContains } from "./shared/predicate.ts";
import { predicateToPrecheck } from "./shared/predicate-score.ts";
import {
  CDK_EXPRESS_MEASUREMENT_HINT,
  CDK_EXPRESS_SUGGESTION,
  CDK_EXPRESS_UPGRADE_SUGGESTION,
  CDK_EXPRESS_WHY,
  cdkVersionIsBelowExpressFloor,
  formatSemver,
  jobTargetsDevelopment,
  groupCdkStepsByCliVersion,
  textDeploysCdkWithoutExpress,
} from "./shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-express-mode-in-development",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-express-mode-in-development.md",
  precheck: predicateToPrecheck([{ pred: sourceContains("cdk"), weight: 1, label: "has-cdk" }]),
} satisfies RuleMeta;

export const preferCdkExpressModeInDevelopmentRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext): Promise<Diagnostic[]> {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const candidates = job.steps.filter((step) => textDeploysCdkWithoutExpress(step.run ?? ""));
      if (candidates.length === 0) {
        continue;
      }

      const { development, production } = jobTargetsDevelopment(workflow, job);
      if (!development || production) {
        continue;
      }

      for (const {
        version: resolvedVersion,
        steps: offendingSteps,
      } of await groupCdkStepsByCliVersion(job, context, candidates)) {
        const needsUpgrade = cdkVersionIsBelowExpressFloor(resolvedVersion);
        const versionLabel = resolvedVersion ? formatSemver(resolvedVersion) : undefined;

        const stepList = offendingSteps
          .map((step) => step.name ?? step.run?.trim() ?? "(unnamed step)")
          .map((label) => `"${label}"`)
          .join(", ");
        const versionClause = versionLabel ? ` (aws-cdk ${versionLabel})` : "";

        findings.push(
          buildDiagnostic(workflow, meta, offendingSteps[0]!.runNode ?? offendingSteps[0]!.node, {
            message: needsUpgrade
              ? `Job "${job.id}" runs development CDK deploy commands without express mode, and the pinned aws-cdk ${versionLabel} predates --express support: ${stepList}.`
              : `Job "${job.id}" runs development CDK deploy commands without express mode${versionClause}: ${stepList}.`,
            why: CDK_EXPRESS_WHY,
            suggestion: needsUpgrade ? CDK_EXPRESS_UPGRADE_SUGGESTION : CDK_EXPRESS_SUGGESTION,
            measurementHint: CDK_EXPRESS_MEASUREMENT_HINT,
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Its CDK deploy, destroy, or bootstrap command(s) (${stepList}) target a development context but omit --express. ${needsUpgrade ? `First bump the aws-cdk CLI to 2.1138.0 or later (currently ${versionLabel}), then ` : ""}add --express. Do not apply express mode to production or release deployments, and keep automatic rollback behavior intentional for development.`,
            score: 40,
          }),
        );
      }
    }

    return findings;
  },
};
