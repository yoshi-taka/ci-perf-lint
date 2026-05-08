import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import type { PipelineDocument } from "../buildkite-workflow.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import type { GitlabCiDocument } from "../gitlab-ci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectRedundantBootstrapToolFromText, usesLanguageInstall } from "./shared/tools.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const meta = {
  id: "redundant-npx-or-bootstrap",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/redundant-npx-or-bootstrap.md",
  scope: "both",
} satisfies RuleMeta;

export const redundantNpxOrBootstrapRule = {
  meta,
  check(
    workflow: WorkflowDocument | PipelineDocument | CircleCiDocument | GitlabCiDocument,
    _context: RuleContext,
  ): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const entries = collectCommandEntries(workflow);

    const jobEntries = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = jobEntries.get(entry.jobName) ?? [];
      list.push(entry);
      jobEntries.set(entry.jobName, list);
    }

    for (const [, jobEntryList] of jobEntries) {
      const hasInstall = jobEntryList.some((e) => usesLanguageInstall(e.text));
      if (!hasInstall) {
        continue;
      }

      for (const entry of jobEntryList) {
        const tool = detectRedundantBootstrapToolFromText(entry.text);
        if (!tool) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, entry.node, {
            message: `Job "${entry.jobName}" installs dependencies and still invokes ${tool} through an x-runner such as npx, pnpx, pnpm dlx, bunx, yarn dlx, uvx, or uv tool run.`,
            why: "After the job installs dependencies, local project CLIs are usually already available from node_modules, the package-manager exec path, or the Python environment. Running them through an x-runner can trigger another resolution path, temporary package lookup or install, and wrapper startup before the actual tool starts.",
            suggestion:
              "If the tool is already available from the installed dependencies, run the local binary directly, use the package-manager exec command that reuses the install, or call an existing package script instead of bootstrapping it again.",
            measurementHint:
              "Compare the lint or check step startup time and total duration before and after removing the extra CLI bootstrap path.",
            aiHandoff: `Review ${workflow.relativePath} job "${entry.jobName}" and replace x-runner based local CLI invocation with a direct command or package script where safe.`,
            score: 72,
          }),
        );
      }
    }

    return findings;
  },
};
