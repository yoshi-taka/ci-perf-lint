import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { detectRedundantBootstrapToolFromText, usesLanguageInstall } from "./shared/tools.ts";
import { extractSemanticSteps, groupStepsByJob } from "./shared/semantic-adapter.ts";

const NPX_RE =
  /\bnpx\b|\bnpm\s+bootstrap\b|\bpnpx\b|\bbunx\b|\byarn\s+dlx\b|\budu\s+dlx\b|\budu\s+tool\s+run\b|\buvx\b|\buv\s+tool\s+run\b/;

const meta = {
  id: "redundant-npx-or-bootstrap",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/redundant-npx-or-bootstrap.md",
  scope: "all",
  precheck: (wf) => (wf.source ? (NPX_RE.test(wf.source) ? 1 : 0) : 0),
} satisfies RuleMeta;

export const redundantNpxOrBootstrapRule = {
  meta,
  check(doc: CIDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const steps = extractSemanticSteps(doc);
    const jobGroups = groupStepsByJob(steps);

    for (const [jobName, jobSteps] of jobGroups) {
      const hasInstall = jobSteps.some(
        (s) => s.commandType === "install" || usesLanguageInstall(s.text),
      );
      if (!hasInstall) {
        continue;
      }

      for (const step of jobSteps) {
        const tool = detectRedundantBootstrapToolFromText(step.text);
        if (!tool) {
          continue;
        }

        findings.push(
          buildDiagnostic(doc, meta, step.node, {
            message: `Job "${jobName}" installs dependencies and still invokes ${tool} through an x-runner such as npx, pnpx, pnpm dlx, bunx, yarn dlx, uvx, or uv tool run.`,
            why: "After the job installs dependencies, local project CLIs are usually already available from node_modules, the package-manager exec path, or the Python environment. Running them through an x-runner can trigger another resolution path, temporary package lookup or install, and wrapper startup before the actual tool starts.",
            suggestion:
              "If the tool is already available from the installed dependencies, run the local binary directly, use the package-manager exec command that reuses the install, or call an existing package script instead of bootstrapping it again.",
            measurementHint:
              "Compare the lint or check step startup time and total duration before and after removing the extra CLI bootstrap path.",
            aiHandoff: `Review ${doc.relativePath} job "${jobName}" and replace x-runner based local CLI invocation with a direct command or package script where safe.`,
            score: 72,
          }),
        );
      }
    }

    return findings;
  },
};
