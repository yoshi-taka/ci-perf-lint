import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { CircleCiDocument } from "../circleci-workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { collectCommandEntries } from "./shared/any-step.ts";

const meta = {
  id: "circleci-unnecessary-setup-remote-docker",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/circleci-unnecessary-setup-remote-docker.md",
  scope: "circleci",
} satisfies RuleMeta;

const DOCKER_COMMAND = /\b(?:docker(?:-compose)?|depot)\b/i;

export const circleciUnnecessarySetupRemoteDockerRule = {
  meta,
  check(doc: CircleCiDocument, _context: RuleContext): Diagnostic[] {
    const findings: Diagnostic[] = [];
    const commandsByJob = new Map<string, string[]>();
    for (const entry of collectCommandEntries(doc)) {
      const commands = commandsByJob.get(entry.jobName) ?? [];
      commands.push(entry.text);
      commandsByJob.set(entry.jobName, commands);
    }

    for (const job of doc.jobs) {
      const remoteDockerSteps = job.steps.filter((step) => step.type === "setup_remote_docker");
      if (remoteDockerSteps.length === 0) {
        continue;
      }
      const otherSteps = job.steps.filter((step) => step.type !== "setup_remote_docker");
      if (otherSteps.some((step) => step.type.toLowerCase().includes("docker"))) {
        continue;
      }
      if (otherSteps.some((step) => step.orbUnresolved)) {
        // An opaque orb may invoke Docker; do not guess.
        continue;
      }
      const commands = commandsByJob.get(job.name) ?? [];
      if (commands.some((command) => DOCKER_COMMAND.test(command))) {
        continue;
      }

      findings.push(
        buildDiagnostic(
          doc,
          meta,
          remoteDockerSteps[0]!.invocationNode ?? remoteDockerSteps[0]!.node,
          {
            message: `Job "${job.name}" runs setup_remote_docker but no Docker command is visible.`,
            why: "setup_remote_docker starts a remote Docker environment for the job and can affect resource allocation and setup time. A job that never invokes Docker does not need it.",
            suggestion:
              "Remove setup_remote_docker unless a referenced orb or script actually uses Docker. If Docker is used indirectly, document the evidence or make the dependency explicit.",
            measurementHint:
              "Compare job setup time and resource usage with and without setup_remote_docker.",
            aiHandoff: `Review ${doc.relativePath} job "${job.name}". Remove setup_remote_docker if no visible Docker command or orb needs a remote Docker daemon; verify the job still passes.`,
            score: 24,
          },
        ),
      );
    }
    return findings;
  },
};
