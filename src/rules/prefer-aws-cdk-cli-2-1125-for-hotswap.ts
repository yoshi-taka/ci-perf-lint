import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { sourceContains } from "./shared/predicate.ts";
import { predicateToPrecheck } from "./shared/predicate-score.ts";
import {
  cdkCliVersionIsBelowHotswapFloor,
  formatSemver,
  resolveCdkCliVersion,
  textUsesCdkHotswap,
} from "./shared/cdk-express.ts";

const meta = {
  id: "prefer-aws-cdk-cli-2-1125-for-hotswap",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/prefer-aws-cdk-cli-2-1125-for-hotswap.md",
  precheck: predicateToPrecheck([
    { pred: sourceContains("hotswap"), weight: 1, label: "has-hotswap" },
    { pred: sourceContains("cdk watch"), weight: 1, label: "has-cdk-watch" },
    { pred: sourceContains("aws-cdk watch"), weight: 1, label: "has-aws-cdk-watch" },
  ]),
} satisfies RuleMeta;

export const preferAwsCdkCli21125ForHotswapRule = {
  meta,
  async check(workflow: WorkflowDocument, context: RuleContext): Promise<Diagnostic[]> {
    const findings: Diagnostic[] = [];
    const resolvedVersion = await resolveCdkCliVersion(workflow, context);

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }

      const hotswapSteps = job.steps.filter((step) => textUsesCdkHotswap(step.run ?? ""));
      if (hotswapSteps.length === 0) {
        continue;
      }

      if (!cdkCliVersionIsBelowHotswapFloor(resolvedVersion)) {
        continue;
      }

      const versionLabel = formatSemver(resolvedVersion!);
      const stepList = hotswapSteps
        .map((step) => step.name ?? step.run?.trim() ?? "(unnamed step)")
        .map((label) => `"${label}"`)
        .join(", ");

      findings.push(
        buildDiagnostic(workflow, meta, hotswapSteps[0]!.runNode ?? hotswapSteps[0]!.node, {
          message: `Job "${job.id}" uses CDK hotswap with aws-cdk ${versionLabel}, which predates the Cloud Control API hotswap engine: ${stepList}.`,
          why: "CDK CLI 2.1116.0-2.1125.0 added a Cloud Control API based hotswap engine, asset rebundling only when assets change, and synchronization against the last hotswap deployment. Together these cut hotswap deployment time by at least 25% and broaden the resource types hotswap can update. Older CLIs fall back to a small set of hardcoded resource types and slower asset handling.",
          suggestion:
            "Upgrade the aws-cdk CLI to 2.1125.0 or later to get the Cloud Control API hotswap engine and asset rebundling improvements.",
          measurementHint:
            "Compare hotswap deployment duration and the set of resources that hotswap can update before and after the CLI upgrade.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}". Its CDK hotswap command(s) (${stepList}) run on aws-cdk ${versionLabel}, below the 2.1125.0 release that completes the faster hotswap engine. Bump the aws-cdk CLI version used by this workflow (for example the install step or devDependency) and keep unrelated changes out of the bump.`,
          score: 34,
        }),
      );
    }

    return findings;
  },
};
