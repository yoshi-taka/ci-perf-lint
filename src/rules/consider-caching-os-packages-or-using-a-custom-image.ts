import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowJob } from "../workflow.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isHeavyJob, jobRunsOnHostedUbuntu, jobUsesContainer } from "./shared/workflow-jobs.ts";

const meta = {
  id: "consider-caching-os-packages-or-using-a-custom-image",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-caching-os-packages-or-using-a-custom-image.md",
} satisfies RuleMeta;

const heavyPackagePattern =
  /\b(build-essential|clang(?:-\d+)?|llvm(?:-\d+)?|webkit2gtk|libgtk-[^ \n]+|libayatana-[^ \n]+|protobuf-compiler|ninja-build|musl-tools|gcc|g\+\+|libssl-dev|libxml2-dev|libxslt-dev|rustc|cargo)\b/i;

function getInstallCommands(job: WorkflowJob): string[] {
  return job.steps
    .map((step) => step.run ?? "")
    .filter((run) => /\b(?:apt|apt-get)\s+install\b/i.test(run));
}

function countInstalledPackages(commands: string[]): number {
  let count = 0;

  for (const command of commands) {
    const normalized = command
      .replace(/\\\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const match = normalized.match(
      /\b(?:apt|apt-get)\s+install\b(?:\s+-[\w-]+(?:[= ][^\s]+)?)*\s+(.+)/i,
    );
    if (!match?.[1]) {
      continue;
    }

    const packages = match[1]
      .split(/\s+/)
      .filter(
        (token) =>
          token.length > 0 &&
          !token.startsWith("-") &&
          !["&&", "||", ";", "|"].includes(token) &&
          !token.includes("="),
      );
    count += packages.length;
  }

  return count;
}

function hasHeavyPackageSet(commands: string[]): boolean {
  return commands.some((command) => heavyPackagePattern.test(command));
}

function hasVisibleOsPackageCache(job: WorkflowJob): boolean {
  return job.steps.some((step) => {
    const uses = step.uses?.toLowerCase() ?? "";
    if (uses.startsWith("awalsh128/cache-apt-pkgs-action@")) {
      return true;
    }

    if (
      !uses.startsWith("actions/cache@") &&
      !uses.startsWith("actions/cache/restore@") &&
      !uses.startsWith("actions/cache/save@")
    ) {
      return false;
    }

    const pathValue = step.with?.path;
    const pathText = Array.isArray(pathValue)
      ? pathValue.filter((entry): entry is string => typeof entry === "string").join("\n")
      : typeof pathValue === "string"
        ? pathValue
        : "";

    return /\/var\/cache\/apt\/archives|\/var\/lib\/apt\/lists/i.test(pathText);
  });
}

export const considerCachingOsPackagesOrUsingACustomImageRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];

    for (const job of workflow.jobs) {
      const installCommands = getInstallCommands(job);
      if (installCommands.length === 0) {
        continue;
      }

      if (!jobRunsOnHostedUbuntu(job) || jobUsesContainer(job) || hasVisibleOsPackageCache(job)) {
        continue;
      }

      const packageCount = countInstalledPackages(installCommands);
      const heavyPackageSet = hasHeavyPackageSet(installCommands);
      const heavyJob = isHeavyJob(job);
      const severity = heavyPackageSet && heavyJob && packageCount >= 2 ? "warning" : "suggestion";

      findings.push(
        buildDiagnostic(workflow, meta, job.idNode ?? job.node, {
          severity,
          message: `Job "${job.id}" installs OS packages at runtime without visible package caching or a prebuilt image strategy.`,
          why:
            severity === "warning"
              ? "This job appears to install a heavier OS package set during execution, which can become a repeat CI bottleneck when the same environment is rebuilt every run."
              : "Runtime OS package installs can add avoidable setup time on repeated CI paths, especially when the same package set is rebuilt often.",
          suggestion:
            "If this install path is slow enough to matter, consider caching OS package artifacts or moving the package set into a custom or prebuilt image, and keep the change only if total job time improves.",
          measurementHint:
            "Compare package-install wall-clock time, cache restore/save time if added, and total job duration before and after introducing OS package caching or a custom image.",
          aiHandoff: `Review ${workflow.relativePath} job "${job.id}" and measure whether repeated OS package installs are a meaningful cost. If they are, test package-archive caching or a custom image and keep the change only when total CI time improves.`,
          score: severity === "warning" ? 44 : 27,
        }),
      );
    }

    return findings;
  },
};
