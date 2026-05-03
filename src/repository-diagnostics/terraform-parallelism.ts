import type { Severity, AnalysisWarning, Diagnostic, RuleMeta } from "../types.ts";
import type { RepositorySignals } from "../repository-signals-types.ts";
import type { RepositoryScanContext } from "../repository-scan-context.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { getLoweredWorkflowStepText } from "../rules/shared/workflow-step-text.ts";

const meta = {
  id: "terraform-parallelism-unconfigured",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/terraform-parallelism-unconfigured.md",
} satisfies RuleMeta;

const TF_COMMANDS = /\bterraform\s+(?:plan|apply|destroy)\b/;

const TF_FILE_EXTENSIONS = /\.tf$/;

function workflowHasTerraformPlanApply(workflow: WorkflowDocument): boolean {
  return workflow.jobs.some((job) =>
    job.steps.some((step) => TF_COMMANDS.test(getLoweredWorkflowStepText(step))),
  );
}

function workflowHasParallelismInStepText(workflow: WorkflowDocument): boolean {
  return workflow.jobs.some((job) =>
    job.steps.some((step) => {
      const text = getLoweredWorkflowStepText(step);
      const matchIndex = text.search(TF_COMMANDS);
      if (matchIndex === -1) {
        return false;
      }

      const afterCommand = text.slice(matchIndex);
      return /--parallelism\s*=\s*\d+/.test(afterCommand);
    }),
  );
}

function workflowHasParallelismInEnv(workflow: WorkflowDocument): boolean {
  return /TF_CLI_ARGS[\s\S]{0,100}parallelism/i.test(workflow.source!);
}

function workflowHasParallelismConfig(workflow: WorkflowDocument): boolean {
  return workflowHasParallelismInStepText(workflow) || workflowHasParallelismInEnv(workflow);
}

async function countTerraformFiles(scanContext: RepositoryScanContext): Promise<number> {
  let count = 0;

  for await (const _relativePath of scanContext.walkFilesIter(".", {
    ignoredDirectories: new Set([".git", "node_modules", ".terraform"]),
    include: (candidatePath) => TF_FILE_EXTENSIONS.test(candidatePath),
  })) {
    count += 1;
  }

  return count;
}

export async function collectTerraformParallelismDiagnostics(
  _repoRoot: string,
  repository: RepositorySignals,
  workflows: WorkflowDocument[],
  _warnings?: AnalysisWarning[],
  scanContext?: RepositoryScanContext,
): Promise<Diagnostic[]> {
  const anyTerraformWorkflow = workflows.find(workflowHasTerraformPlanApply);
  if (!anyTerraformWorkflow) {
    return [];
  }

  const anyParallelismConfig = workflows.some(workflowHasParallelismConfig);
  if (anyParallelismConfig) {
    return [];
  }

  if (!scanContext) {
    return [];
  }

  const tfFileCount = await countTerraformFiles(scanContext);
  const severity: Severity = tfFileCount >= 10 ? "warning" : "suggestion";

  return [
    buildRepositoryDiagnostic(repository, meta, {
      severity,
      location: {
        path: anyTerraformWorkflow.relativePath,
        line: 1,
        column: 1,
      },
      message:
        "No --parallelism or TF_CLI_ARGS with parallelism found in any workflow that runs terraform plan/apply/destroy.",
      why: "Terraform defaults to parallelism=10, which is slow for large configurations. If no workflow has ever set --parallelism, nobody on the team is thinking about it. Tuning it to match runner capacity and resource dependency graph is one of the highest-leverage terraform CI optimizations.",
      suggestion:
        "Add --parallelism=N to terraform plan/apply/destroy commands or set TF_CLI_ARGS=-parallelism=N at the workflow or job level. Start with 30-50 on standard GitHub runners and adjust based on resource contention and API rate limits.",
      measurementHint:
        "Compare plan/apply duration before and after changing --parallelism. Also monitor API rate limiting (e.g., AWS, Azure) at higher values.",
      aiHandoff: `Review all terraform workflows in this repository. Add --parallelism=N to terraform plan/apply/destroy commands, or set TF_CLI_ARGS env var at the workflow or job level. Standard GitHub runners can typically handle 30-50. Preserve existing terraform commands and ordering.`,
      score: 45,
    }),
  ];
}
