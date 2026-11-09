import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { shellInvocations } from "./shared/shell-invocations.ts";

const meta = {
  id: "tox-without-tox-uv",
  severity: "warning",
  confidence: "medium",
  docsPath: "docs/rules/tox-without-tox-uv.md",
} satisfies RuleMeta;

function stepIsToxRun(run: string): boolean {
  return shellInvocations(run).some(
    ([tool, ...args]) =>
      tool === "tox" && !args.some((arg) => ["--help", "-h", "--version"].includes(arg)),
  );
}

function stepInstallsToxUv(run: string): boolean {
  return shellInvocations(run).some(([tool, ...args]) => {
    if (tool === "uv" && args[0] === "pip") {
      args = args.slice(1);
    } else if (!/^pip(?:3(?:\.\d+)?)?$/.test(tool ?? "")) {
      return false;
    }
    if (args[0] !== "install") {
      return false;
    }
    if (args.some((arg) => ["--help", "-h", "--version", "--dry-run"].includes(arg))) {
      return false;
    }
    for (let index = 1; index < args.length; index++) {
      const arg = args[index]!;
      if (
        [
          "-r",
          "--requirement",
          "-c",
          "--constraint",
          "--index-url",
          "--extra-index-url",
          "--target",
          "--prefix",
          "--cache-dir",
          "--config-settings",
          "--python",
        ].includes(arg)
      ) {
        index++;
      } else if (/^tox-uv(?:$|[<>=!~;[])/i.test(arg)) {
        return true;
      }
    }
    return false;
  });
}

function jobHasToxUvSetup(job: { steps: { run?: string }[] }): boolean {
  return job.steps.some((step) => stepInstallsToxUv(step.run ?? ""));
}

function findToxRunSteps(job: { steps: { run?: string }[] }): number[] {
  return job.steps
    .map((step, i) => (stepIsToxRun(step.run ?? "") ? i : -1))
    .filter((i) => i !== -1);
}

export const toxWithoutToxUvRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      if (jobHasToxUvSetup(job)) {
        continue;
      }

      const toxSteps = findToxRunSteps(job);
      if (toxSteps.length === 0) {
        continue;
      }

      for (const stepIndex of toxSteps) {
        const step = job.steps[stepIndex]!;
        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" runs tox without tox-uv installed.`,
            why: "tox-uv is a plugin that replaces tox's default venv creation and package installation with uv's faster resolver and installer. It requires no config changes and is auto-discovered when installed alongside tox.",
            suggestion:
              "Add a step to install tox-uv alongside tox (e.g., `pip install tox-uv` or `pip install tox tox-uv`) before the tox run step. tox-uv is auto-discovered as a tox plugin and requires no configuration.",
            measurementHint:
              "Compare total job duration before and after adding tox-uv to the tox installation step.",
            aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and add tox-uv to the tox installation step (e.g., replace "pip install tox" with "pip install tox tox-uv"). tox-uv hooks into tox's venv and install lifecycle automatically.`,
            score: 42,
          }),
        );
      }
    }

    return findings;
  },
};
