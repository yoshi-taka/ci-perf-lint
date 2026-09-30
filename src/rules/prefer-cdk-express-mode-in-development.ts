import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { sourceContains } from "./shared/predicate.ts";
import { predicateToPrecheck } from "./shared/predicate-score.ts";
import { workflowLooksReleaseLike } from "./shared/workflow-jobs.ts";
import { getTriggerSemantics } from "./shared/workflow-triggers.ts";
import {
  CDK_EXPRESS_MEASUREMENT_HINT,
  CDK_EXPRESS_SUGGESTION,
  CDK_EXPRESS_UPGRADE_SUGGESTION,
  CDK_EXPRESS_WHY,
  cdkVersionIsBelowExpressFloor,
  formatSemver,
  resolveCdkCliVersion,
  textDeploysCdkWithoutExpress,
  type SemverTuple,
} from "./shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-express-mode-in-development",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-express-mode-in-development.md",
  precheck: predicateToPrecheck([{ pred: sourceContains("cdk"), weight: 1, label: "has-cdk" }]),
} satisfies RuleMeta;

const PRODUCTION_ENVIRONMENT = /(?:^|[^a-z])(?:prod|production|prd)(?:$|[^a-z])/i;
const DEVELOPMENT_ENVIRONMENT = /(?:^|[^a-z])(?:dev|development|sandbox|preview)(?:$|[^a-z])/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readEnvironmentNames(job: WorkflowJob): string[] {
  const environment = job.raw.environment;
  if (typeof environment === "string") {
    return [environment];
  }
  const record = asRecord(environment);
  const name = record?.name;
  return typeof name === "string" ? [name] : [];
}
function jobTargetsDevelopment(
  workflow: WorkflowDocument,
  job: WorkflowJob,
): { development: boolean; production: boolean } {
  const environmentNames = readEnvironmentNames(job);
  const production =
    environmentNames.some((name) => PRODUCTION_ENVIRONMENT.test(name)) ||
    workflowLooksReleaseLike(workflow, job);
  const triggers = getTriggerSemantics(workflow);
  const development =
    environmentNames.some((name) => DEVELOPMENT_ENVIRONMENT.test(name)) || triggers.hasPullRequest;
  return { development, production: production || triggers.hasTagOnlyPush };
}

export const preferCdkExpressModeInDevelopmentRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext): Promise<Diagnostic[]> {
    const findings: Diagnostic[] = [];
    let resolvedVersion: SemverTuple | undefined;
    let versionResolved = false;

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const offendingSteps = job.steps.filter((step) =>
        textDeploysCdkWithoutExpress(step.run ?? ""),
      );
      if (offendingSteps.length === 0) {
        continue;
      }

      const { development, production } = jobTargetsDevelopment(workflow, job);
      if (!development || production) {
        continue;
      }

      if (!versionResolved) {
        resolvedVersion = await resolveCdkCliVersion(workflow, context);
        versionResolved = true;
      }
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

    return findings;
  },
};
