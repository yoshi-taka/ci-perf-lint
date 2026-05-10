import type { RuleMeta } from "../types.ts";
import type { RuleContext } from "../rule-engine.ts";
import type { WorkflowDocument, WorkflowStep } from "../workflow.ts";
import {
  detectInstallCommand,
  detectInstallCommandFromText,
  detectLintTool,
  normalizeRunCommand,
} from "./shared/tools.ts";
import { buildDiagnostic } from "./shared/diagnostics.ts";
import { jobHasMatrix } from "./shared/workflow-jobs.ts";

const meta = {
  id: "duplicate-install-or-lint",
  severity: "suggestion",
  confidence: "medium",
  docsPath: "docs/rules/duplicate-install-or-lint.md",
  requiredFeatures: {
    workflowFacts: {
      looksMetaCheckLike: false,
    },
  },
} satisfies RuleMeta;

interface JobPattern {
  jobId: string;
  step: WorkflowStep;
}

export const duplicateInstallOrLintRule = {
  meta,
  check(workflow: WorkflowDocument, _context: RuleContext) {
    const patterns = new Map<string, JobPattern[]>();

    for (const job of workflow.jobs) {
      if (job.usesReusableWorkflow || jobHasMatrix(job)) {
        continue;
      }

      const installManagers = new Set<string>();
      const lintOccurrences: { tool: string; step: WorkflowStep }[] = [];

      for (const step of job.steps) {
        const installManager = detectInstallCommand(step);
        if (installManager) {
          installManagers.add(installManager);
        }

        const tool = detectLintTool(step);
        if (tool) {
          lintOccurrences.push({ tool, step });
        }
      }

      if (installManagers.size !== 1 || lintOccurrences.length === 0) {
        continue;
      }

      const [installManager] = [...installManagers];
      const uniqueTools = new Map<string, WorkflowStep>();

      for (const occurrence of lintOccurrences) {
        if (!uniqueTools.has(occurrence.tool)) {
          uniqueTools.set(occurrence.tool, occurrence.step);
        }
      }

      function signatureRun(run: string): string {
        if (!run.includes("\n")) {
          return run;
        }
        for (const line of run.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) {
            continue;
          }
          if (detectInstallCommandFromText(trimmed)) {
            continue;
          }
          return trimmed;
        }
        return run;
      }

      for (const [tool, step] of uniqueTools) {
        const normalized = normalizeRunCommand(step.run);
        const run = signatureRun(normalized);
        const signature = run ? `${installManager}:${tool}::${run}` : `${installManager}:${tool}`;
        const jobs = patterns.get(signature) ?? [];
        jobs.push({ jobId: job.id, step });
        patterns.set(signature, jobs);
      }
    }

    return [...patterns.entries()]
      .filter(([, jobs]) => jobs.length >= 2)
      .map(([signature, jobs]) => {
        const [prefix] = signature.split("::");
        const [installManager, tool] = (prefix ?? signature).split(":");
        const jobIds = jobs.map((job) => job.jobId).sort();
        const firstJob = jobs[0]!;

        return buildDiagnostic(workflow, meta, firstJob.step.runNode ?? firstJob.step.node, {
          message: `Multiple jobs (${jobIds.join(", ")}) each run ${installManager} install steps and ${tool}.`,
          why: "Install and lint steps are not shared across jobs: each runner repeats cache restore, dependency linking or install verification, lint config loading, file discovery, and tool startup. If the jobs lint the same target set, this multiplies runner time without producing a different check result.",
          suggestion:
            "Review whether the duplicated install and lint flow can be consolidated, or narrow each lint invocation so every job owns a distinct target set.",
          measurementHint:
            "Compare total workflow runner minutes, install duration, and lint duration after consolidating or narrowing one duplicated install-plus-lint path.",
          aiHandoff: `Review ${workflow.relativePath} jobs ${jobIds.join(", ")} for duplicated ${installManager} install and ${tool} work, and only consolidate if the jobs are truly overlapping.`,
          score: 58,
        });
      });
  },
};
