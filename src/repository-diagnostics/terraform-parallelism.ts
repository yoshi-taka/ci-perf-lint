import type { Severity, Diagnostic, RuleMeta } from "../types.ts";
import { buildRepositoryDiagnostic } from "./diagnostics.ts";
import type { RepositoryDiagnosticContext } from "./collector-types.ts";
import { collectTerraformCommands } from "./terraform-commands.ts";
import { getLocation } from "../workflow.ts";
import { getTerraformFileIndex } from "./terraform-files.ts";

const meta = {
  id: "terraform-parallelism-unconfigured",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/terraform-parallelism-unconfigured.md",
} satisfies RuleMeta;

const PARALLELISM = /(?:^|\s)--?parallelism(?:\s*=\s*|\s+)\d+(?=\s|$)/;

export async function collectTerraformParallelismDiagnostics(
  context: RepositoryDiagnosticContext,
): Promise<Diagnostic[]> {
  const untuned = collectTerraformCommands(context.workflows).filter((command) => {
    if (!["plan", "apply", "destroy"].includes(command.verb)) {
      return false;
    }
    const env = [command.env.TF_CLI_ARGS, command.env[`TF_CLI_ARGS_${command.verb}`]]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    return !PARALLELISM.test(command.args.join(" ")) && !PARALLELISM.test(env);
  });
  const example = untuned[0];
  if (!example) {
    return [];
  }

  const { files } = await getTerraformFileIndex(context.scanContext);
  const tfFileCount = files.length;
  const severity: Severity = tfFileCount >= 10 ? "warning" : "suggestion";

  return [
    buildRepositoryDiagnostic(context.repository, meta, {
      severity,
      location: getLocation(example.workflow, example.step.runNode ?? example.step.node),
      message: `${untuned.length} Terraform plan/apply/destroy command(s) lack -parallelism/--parallelism or an applicable TF_CLI_ARGS setting.`,
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
