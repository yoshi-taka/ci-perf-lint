import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobUsesContainer } from "./shared/workflow-jobs.ts";
import { setDifference } from "../set-algebra.ts";
import {
  toolInvocations,
  invocationOperands,
  invocationOptions,
} from "./shared/tool-command-evidence.ts";
import { dependencyInstallCommands } from "./shared/dependency-install-evidence.ts";

const meta = {
  id: "wasteful-package-install-in-container",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/wasteful-package-install-in-container.md",
} satisfies RuleMeta;

function extractPackagesFromInstall(run: string): string[] {
  const normalized = run.replace(/\\\r?\n/g, " ");
  const packages = dependencyInstallCommands(normalized)
    .filter(({ tool }) => ["apt", "apt-get", "yum", "dnf", "apk"].includes(tool))
    .flatMap(({ packages: names }) => names);
  for (const words of toolInvocations(normalized)) {
    if (
      !["brew", "choco"].includes(words[0] ?? "") ||
      invocationOptions(words).some(({ name }) =>
        ["--help", "-h", "--version", "--dry-run"].includes(name),
      )
    ) {
      continue;
    }
    const operands = invocationOperands(words);
    if (operands[0] === "install") {
      packages.push(...operands.slice(1));
    }
  }
  return [
    ...new Set(
      packages
        .map((pkg) => pkg.split("=")[0]!)
        .filter((pkg) => /^[a-zA-Z0-9][\w.+:/-]*$/.test(pkg)),
    ),
  ];
}

function packagesUsedLater(
  packages: string[],
  steps: WorkflowStep[],
  startIndex: number,
): Set<string> {
  const used = new Set<string>();
  const laterTools = new Set(
    steps
      .slice(startIndex + 1)
      .flatMap((step) =>
        toolInvocations(step.run ?? "").map(([tool]) =>
          (tool ?? "").split("/").at(-1)!.toLowerCase(),
        ),
      ),
  );

  for (const pkg of packages) {
    if (laterTools.has(pkg.toLowerCase())) {
      used.add(pkg);
    }
  }

  return used;
}

export const wastefulPackageInstallInContainerRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: ReturnType<typeof buildDiagnostic>[] = [];

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow) {
        continue;
      }
      if (!jobUsesContainer(job)) {
        continue;
      }

      for (let i = 0; i < job.steps.length; i++) {
        const step = job.steps[i]!;
        if (!step.run) {
          continue;
        }

        const packages = extractPackagesFromInstall(step.run);
        if (packages.length === 0) {
          continue;
        }

        const used = packagesUsedLater(packages, job.steps, i);
        const unused = [...setDifference(packages, used)];
        if (unused.length === 0) {
          continue;
        }

        findings.push(
          buildDiagnostic(workflow, meta, step.runNode ?? step.node, {
            message: `Job "${job.id}" runs inside a container (${String(
              job.raw.container,
            )}) but installs ${unused.join(", ")}, which ${
              unused.length > 1 ? "are" : "is"
            } not referenced in later steps.`,
            why:
              "Dependencies should be baked into the Docker image when a job runs in a container. " +
              "Installing packages in CI steps adds runtime overhead, breaks reproducibility, " +
              "and suggests the Dockerfile is incomplete.",
            suggestion:
              `Add ${unused.join(", ")} to the Docker image used by job "${job.id}" instead of installing at runtime. ` +
              "Update the Dockerfile and rebuild the image.",
            measurementHint:
              "Compare job wall-clock time before and after moving the package install into the Docker image.",
            aiHandoff:
              `Review job "${job.id}" in ${workflow.relativePath}. The step "${step.run}" installs packages that are not used later. ` +
              `Add ${unused.join(", ")} to the Dockerfile for the container image used by this job.`,
            score: 62,
          }),
        );
      }
    }

    return findings;
  },
};
