import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobUsesContainer } from "./shared/workflow-jobs.ts";
import { setDifference } from "../set-algebra.ts";

const meta = {
  id: "wasteful-package-install-in-container",
  severity: "warning",
  confidence: "high",
  docsPath: "docs/rules/wasteful-package-install-in-container.md",
} satisfies RuleMeta;

const shellOperators = new Set(["&&", "||", ";", "|", "&"]);

const installPatterns = [
  /\b(?:sudo\s+)?(?:apt(?:-get)?|yum|dnf)\s+install\b(.+)$/gim,
  /\b(?:sudo\s+)?apk\s+add\b(.+)$/gim,
  /\b(?:sudo\s+)?brew\s+install\b(.+)$/gim,
  /\b(?:sudo\s+)?choco\s+install\b(.+)$/gim,
];

function extractPackagesFromInstall(run: string): string[] {
  const packages: string[] = [];

  for (const pattern of installPatterns) {
    for (const match of run.matchAll(pattern)) {
      if (!match[1]) {
        continue;
      }

      const tokens = match[1].trim().split(/\s+/);
      for (const token of tokens) {
        if (token.startsWith("-")) {
          continue;
        }
        if (shellOperators.has(token)) {
          continue;
        }
        const pkg = token.split("=")[0]!;
        if (pkg.length > 0) {
          packages.push(pkg);
        }
      }
    }
  }

  return [...new Set(packages)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function packagesUsedLater(
  packages: string[],
  steps: WorkflowStep[],
  startIndex: number,
): Set<string> {
  const used = new Set<string>();
  const laterText = steps
    .slice(startIndex + 1)
    .map((s) => [s.name ?? "", s.run ?? "", s.uses ?? ""].join(" "))
    .join(" ")
    .toLowerCase();

  for (const pkg of packages) {
    const pattern = new RegExp(`(?<=^|\\s)${escapeRegex(pkg)}(?=\\s|$)`);
    if (pattern.test(laterText)) {
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
