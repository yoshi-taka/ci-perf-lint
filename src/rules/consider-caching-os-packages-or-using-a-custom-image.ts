import type { Diagnostic, RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowJob } from "../workflow.ts";
import { collectCommandEntries, type CIDocument } from "./shared/any-step.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { isHeavyJob, jobRunsOnHostedUbuntu, jobUsesContainer } from "./shared/workflow-jobs.ts";
import { jobAllowsActionsCacheRestore } from "./shared/workflow-caches.ts";
import { collectAptInstallCommands } from "./shared/os-package-commands.ts";

const meta = {
  id: "consider-caching-os-packages-or-using-a-custom-image",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/consider-caching-os-packages-or-using-a-custom-image.md",
  scope: "all",
} satisfies RuleMeta;

const heavyPackagePattern =
  /\b(build-essential|clang(?:-\d+)?|llvm(?:-\d+)?|webkit2gtk|libgtk-[^ \n]+|libayatana-[^ \n]+|protobuf-compiler|ninja-build|musl-tools|gcc|g\+\+|libssl-dev|libxml2-dev|libxslt-dev|rustc|cargo)\b/i;

function getInstallCommands(job: WorkflowJob) {
  return job.steps.flatMap((step) => collectAptInstallCommands(step.run ?? ""));
}

function legacyPackageEstimate(command: string): number {
  // Keep the existing severity heuristic during evidence migration. Only parsed
  // install invocations reach this estimate, never display text or later commands.
  const match = command.match(
    /\b(?:apt|apt-get)\s+install\b(?:\s+-[\w-]+(?:[= ][^\s]+)?)*\s+(.+)/i,
  );
  return (
    match?.[1]
      ?.split(/\s+/)
      .filter((token) => token && !token.startsWith("-") && !token.includes("=")).length ?? 0
  );
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

function circleCiHasAptCache(job: {
  steps: { type: string; cachePaths?: string[]; cacheKey?: string; restoreKeys?: string[] }[];
}): boolean {
  return job.steps.some((step) => {
    if (step.type !== "save_cache" && step.type !== "restore_cache") {
      return false;
    }
    const text = [
      step.cacheKey ?? "",
      ...(step.restoreKeys ?? []),
      ...(step.cachePaths ?? []),
    ].join("\n");
    return /(?:^|[/\s-])(?:var\/cache\/apt|var\/lib\/apt|apt)(?:$|[/\s-])/i.test(text);
  });
}

function nonGitHubOsPackageFindings(doc: CIDocument, findings: Diagnostic[]): void {
  if (doc.kind === "buildkite") {
    return;
  }
  const commandsByJob = new Map<
    string,
    {
      commands: ReturnType<typeof collectAptInstallCommands>;
      node: Parameters<typeof buildDiagnostic>[2];
    }
  >();
  for (const entry of collectCommandEntries(doc)) {
    const commands = collectAptInstallCommands(entry.text);
    if (commands.length === 0) {
      continue;
    }
    const existing = commandsByJob.get(entry.jobName) ?? { commands: [], node: entry.node };
    existing.commands.push(...commands);
    commandsByJob.set(entry.jobName, existing);
  }

  for (const [jobName, jobCommands] of commandsByJob) {
    if (doc.kind === "circleci") {
      const job = doc.jobs.find((candidate) => candidate.name === jobName);
      if (job && circleCiHasAptCache(job)) {
        continue;
      }
    }
    const packages = jobCommands.commands.flatMap((command) => command.packages);
    const packageCount = jobCommands.commands.reduce(
      (count, command) => count + command.packages.length,
      0,
    );
    const heavyPackageSet = packages.some((name) => heavyPackagePattern.test(name));
    const severity = heavyPackageSet && packageCount >= 2 ? "warning" : "suggestion";
    findings.push(
      buildDiagnostic(doc, meta, jobCommands.node, {
        severity,
        message: `Job "${jobName}" installs OS packages at runtime without visible package caching or a prebuilt image strategy.`,
        why:
          severity === "warning"
            ? "This job appears to install a heavier OS package set during execution, which can become a repeat CI bottleneck when the same environment is rebuilt every run."
            : "Runtime OS package installs can add avoidable setup time on repeated CI paths, especially when the same package set is rebuilt often.",
        suggestion:
          doc.kind === "circleci"
            ? "If this install path is slow enough to matter, add CircleCI save_cache/restore_cache for the apt package paths or move the package set into a custom image. Keep the change only if total job time improves."
            : "If this install path is slow enough to matter, consider caching OS package artifacts or moving the package set into a custom image, and keep the change only if total job time improves.",
        measurementHint:
          "Compare package-install wall-clock time, cache restore/save time if added, and total job duration before and after introducing OS package caching or a custom image.",
        aiHandoff: `Review ${doc.relativePath} job "${jobName}" and measure whether repeated OS package installs are a meaningful cost. If they are, test package-archive caching or a custom image and keep the change only when total CI time improves.`,
        score: severity === "warning" ? 44 : 27,
      }),
    );
  }
}

export const considerCachingOsPackagesOrUsingACustomImageRule = {
  meta,
  check(workflow: CIDocument, _context: RuleContext) {
    const findings: Diagnostic[] = [];
    if (workflow.kind !== "github-actions") {
      nonGitHubOsPackageFindings(workflow, findings);
      return findings;
    }

    for (const job of workflow.jobs) {
      const installCommands = getInstallCommands(job);
      if (installCommands.length === 0) {
        continue;
      }

      if (
        !jobAllowsActionsCacheRestore(workflow, job) ||
        !jobRunsOnHostedUbuntu(job) ||
        jobUsesContainer(job) ||
        hasVisibleOsPackageCache(job)
      ) {
        continue;
      }

      const packages = installCommands.flatMap((command) => command.packages);
      const packageCount = installCommands.reduce(
        (count, command) =>
          count + Math.min(command.packages.length, legacyPackageEstimate(command.command)),
        0,
      );
      const heavyPackageSet = packages.some((name) => heavyPackagePattern.test(name));
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
