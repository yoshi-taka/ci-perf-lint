import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { sourceContains } from "./shared/predicate.ts";
import { predicateToPrecheck } from "./shared/predicate-score.ts";
import {
  cdkCliVersionSupportsMethodDirect,
  formatSemver,
  jobTargetsDevelopment,
  resolveCdkCliVersion,
  textDeploysCdkWithoutMethodDirect,
  type SemverTuple,
} from "./shared/cdk-express.ts";

const meta = {
  id: "prefer-cdk-method-direct-in-development",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-cdk-method-direct-in-development.md",
  precheck: predicateToPrecheck([
    { pred: sourceContains("cdk deploy"), weight: 1, label: "has-cdk-deploy" },
  ]),
} satisfies RuleMeta;

export const preferCdkMethodDirectInDevelopmentRule = {
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
        textDeploysCdkWithoutMethodDirect(step.run ?? ""),
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
      if (!cdkCliVersionSupportsMethodDirect(resolvedVersion)) {
        continue;
      }

      const stepList = offendingSteps
        .map((step) => step.name ?? step.run?.trim() ?? "(unnamed step)")
        .map((label) => `"${label}"`)
        .join(", ");
      const versionClause = resolvedVersion ? ` (aws-cdk ${formatSemver(resolvedVersion)})` : "";

      findings.push(
        buildDiagnostic(workflow, meta, offendingSteps[0]!.runNode ?? offendingSteps[0]!.node, {
          message: `Job "${job.id}" runs a development cdk deploy without --method=direct${versionClause}: ${stepList}.`,
          why: "By default cdk deploy creates and executes a CloudFormation change set, which can add 6-15 seconds per stack before the deployment starts. --method=direct applies the change immediately through CreateStack or UpdateStack, skipping change set creation while still performing a full CloudFormation deployment with automatic rollback and stabilization.",
          suggestion:
            "Use cdk deploy --method=direct for development deployments to skip change set creation.",
          measurementHint:
            "Compare deployment wall-clock time before and after switching to --method=direct, and confirm no change-set review or tooling depends on the change set.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Its development cdk deploy command(s) (${stepList}) omit --method=direct. Add --method=direct, but do not use it where a change set is required (--change-set-name, --import-existing-resources, --revert-drift) or where a review step inspects the change set. Do not apply this to production or release deployments.`,
          score: 32,
        }),
      );
    }

    return findings;
  },
};
